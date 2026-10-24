/**
 * Hook 执行器 —— 跑子进程
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 为什么用子进程而不是函数
 *
 * 因为 hook 的价值在于【用户能自己写】。
 * 如果 hook 只能是插件内部的 TypeScript 函数，用户就得改插件代码、
 * 等插件发版 —— 那还不如不加这个抽象。
 *
 * 子进程的形式（跑一条命令）意味着：
 *   · 用户用任何语言写（bash / python / node / pwsh）
 *   · 用户不用改插件代码、不用等发版
 *   · hook 崩了不会拖垮插件进程（真的隔离，不只是 try/catch）
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 通信方式（抄 goose 的做法）
 *
 *   stdin  ← 一个 JSON 对象（事件上下文）
 *   stdout → hook 的输出（给模型看 / 注入上下文）
 *   stderr → 错误信息（只记日志）
 *   退出码 → 0 = 放行，非 0 = 否决
 */

import { spawn } from 'child_process';
import { DEFAULT_HOOK_TIMEOUT_MS } from './types';

export interface HookRunResult {
  /** 退出码（null = 被杀 / 没跑起来） */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** 超时被kill */
  timedOut: boolean;
  /**
   * ⭐ 命令根本不存在
   *
   * ⚠️ 必须和"跑起来了但失败"区分开：
   *   · 命令不存在 → 用户还没写这个脚本 → 不阻断，只记日志
   *   · 命令存在但退出码非 0 → hook 明确否决 → 阻断
   *
   *   搞混这两者的后果：用户还没配好 hooks.json，
   *   agent 就被无限打回，什么都干不成。
   */
  notFound: boolean;
  /** 进程级错误（spawn 失败等） */
  error?: string;
}

/**
 * 判断"命令不存在"的特征串
 *
 * ⚠️ 这套文本匹配在 Windows 上【基本没用】，实测踩到的坑：
 *   cmd.exe 的报错是中文（"不是内部或外部命令"），而且是【GBK 编码】的；
 *   Node 默认按 UTF-8 解码子进程输出，出来的是一串乱码（U+FFFD），
 *   正则永远匹配不上 —— 而"命令不存在"恰恰是最需要被识别的情况。
 *
 *   所以真正的判定靠下面的【主动探测】，文本匹配只作为 POSIX 的快路径。
 */
const NOT_FOUND_PATTERNS =
  /不是内部或外部命令|不是可识别的 cmdlet|command not found|not recognized as an internal or external command|No such file or directory|CommandNotFoundException/i;

/**
 * 提取命令行的第一个"词" —— 用来探测可执行文件在不在
 *
 * 只做最朴素的处理：
 *   · 引号包起来的取引号里的
 *   · 否则取到第一个空白/管道/重定向符为止
 */
function firstToken(command: string): string {
  const s = command.trim();
  if (!s) return '';
  if (s[0] === '"' || s[0] === "'") {
    const end = s.indexOf(s[0], 1);
    if (end > 0) return s.slice(1, end);
  }
  const stop = s.search(/[\s&|;<>()]/);
  return stop > 0 ? s.slice(0, stop) : s;
}

/**
 * 探测可执行文件是否存在
 *
 * ⚠️ 为什么必须主动探测（而不是读 shell 的报错）：
 *   见上面 NOT_FOUND_PATTERNS 的注释 —— Windows 的报错是 GBK 的，
 *   解码成 UTF-8 就是乱码，靠文本匹配【不可靠】。
 *
 *   而"命令不存在"和"命令跑了但失败"必须区分开：
 *     · 前者 → 用户还没写这个脚本 → 跳过这个 hook，不阻断
 *     · 后者 → hook 明确否决 → 阻断
 *   搞混的后果：用户还没配好 hooks.json，agent 就被无限打回。
 */
async function commandExists(command: string, cwd: string): Promise<boolean> {
  const token = firstToken(command);
  if (!token) return true; // 探测不了就当它存在（保守：宁可阻断）

  const probe =
    process.platform === 'win32' ? `where "${token}"` : `command -v "${token}"`;

  try {
    const r = await runHookCommand(probe, cwd, {}, 5000, { noProbe: true });
    // ⚠️ 探测命令自己失败 → 当作"存在"（保守：宁可阻断也别放过）
    if (r.timedOut || r.error) return true;
    return r.exitCode === 0;
  } catch {
    return true;
  }
}

/**
 * 跑一条 hook 命令
 *
 * @param command  命令行
 * @param cwd      工作目录
 * @param payload  传给 stdin 的 JSON
 * @param timeoutMs 超时
 */
export function runHookCommand(
  command: string,
  cwd: string,
  payload: unknown,
  timeoutMs: number = DEFAULT_HOOK_TIMEOUT_MS,
  /**
   * ⚠️ 内部用：跳过"命令是否存在"的探测。
   *   必须有，否则探测命令自己失败时又会去探测 → 无限递归。
   */
  opts?: { noProbe?: boolean },
): Promise<HookRunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const done = (r: HookRunResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let child: ReturnType<typeof spawn>;
    try {
      // ⚠️ shell: true —— 用户写的是一整条命令行（可能带管道/重定向），
      //    不是单个可执行文件。
      //    代价是命令要转义 —— 但这跟用户在终端里敲命令的直觉一致，
      //    比要求用户自己处理 argv 数组更友好。
      child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e: any) {
      done({
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        notFound: false,
        error: e?.message || String(e),
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* 已经死了就算了 */
      }
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (e: any) => {
      clearTimeout(timer);
      done({
        exitCode: null,
        stdout,
        stderr,
        timedOut: false,
        notFound: false,
        error: e?.message || String(e),
      });
    });

    child.on('close', async (code) => {
      clearTimeout(timer);
      const combined = `${stdout}\n${stderr}`;

      // POSIX：退出码 127 就是"命令找不到"
      let notFound = code === 127 || NOT_FOUND_PATTERNS.test(combined);

      // Windows / 其它：靠主动探测
      // ⚠️ 只在【失败】时才探测（成功的命令不用多花一次进程）
      if (!notFound && code !== null && code !== 0 && !opts?.noProbe) {
        notFound = !(await commandExists(command, cwd));
      }

      done({ exitCode: code, stdout, stderr, timedOut, notFound });
    });

    // 把上下文喂给 hook
    try {
      child.stdin?.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    } catch {
      try {
        child.stdin?.end();
      } catch {
        /* hook 没读 stdin，无所谓 */
      }
    }
  });
}
