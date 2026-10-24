/**
 * run_shell 工具
 *
 * 设计：
 * - 跨平台（Windows 用 cmd /c，Unix 用 bash）
 * - 超时控制（默认 30 秒）
 * - 输出截断（防 LLM 上下文爆炸）——⭐ 保留【尾部】而不是头部
 * - 危险命令提示
 * - 支持 AbortSignal 取消（用户点"停止"时能杀掉子进程）
 *
 * ⭐ 为什么要保留尾部（抄自 goose shell.rs:158）：
 *   编译错误、测试失败报告、python traceback 全部在输出【末尾】。
 *   从头截断 = 把最关键的信息全扔了，LLM 只能看到一堆无关的前置日志，
 *   然后开始瞎猜哪里错了。这是从头截断最大的坑。
 */

import { exec, spawn } from 'child_process';
import * as path from 'path';
import { Tool, ToolResult } from './base';
import { resolveInWorkspace, getDefaultCwd } from './paths';
import { redactContent, redactionNotice, commandTouchesSensitiveFile } from './redact';
import { approveToolCall, detectDangerousCommand } from './approval';
import { execMeta } from './meta';

const MAX_OUTPUT_CHARS = 30000;
const DEFAULT_TIMEOUT = 30_000; // 30 秒

/** 高危但常见的命令——提示但不阻断（太敏感会让人烦） */
const RISKY_PATTERNS: Array<{ pattern: RegExp; note: string }> = [
  { pattern: /\bgit\s+push\b/i, note: '会推送到远端' },
  { pattern: /\bnpm\s+(publish|install\s+-g)/i, note: '会发布包/全局安装' },
  { pattern: /\bpip\s+install\b/i, note: '会修改 Python 环境' },
  { pattern: /\bgit\s+commit\b/i, note: '会创建提交' },
  { pattern: /\bgit\s+(checkout|reset|clean|stash)\b/i, note: '会改动 git 状态' },
];

export class RunShellTool implements Tool {
  readonly name = 'run_shell';
  // run_shell 不固定 needsCheckpoint —— 它能不能改文件取决于命令本身，
  // 靠 DANGEROUS_PATTERNS 在执行前单独判断更准。
  readonly meta = execMeta(false);
  readonly description =
    '执行 shell 命令。默认超时 30 秒。支持 working_dir 指定目录（必须在工作区内）。\n' +
    '输出超过 30000 字符时保留【开头和结尾】（中间省略），因为报错信息通常在结尾。\n' +
    '命令会真实修改你的系统，执行前会向用户展示高危操作确认。';
  readonly parameters = {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的命令' },
      working_dir: { type: 'string', description: '执行目录（必须在工作区内）' },
      timeout: { type: 'integer', description: '超时毫秒（默认 30000）' },
    },
    required: ['command'],
  };

  async execute(args: {
    command: string;
    working_dir?: string;
    timeout?: number;
    signal?: AbortSignal;
  }): Promise<ToolResult> {
    const timeout = args.timeout || DEFAULT_TIMEOUT;

    // 执行目录也必须在工作区内（否则等于给了一条跳出沙箱的路）
    // ⚠️ 默认目录用 getDefaultCwd()（= VS Code 工作区根），不是 process.cwd()
    let cwd = getDefaultCwd();
    if (args.working_dir) {
      const guard = resolveInWorkspace(args.working_dir);
      if (!guard.ok) {
        return { content: guard.error!, isError: true };
      }
      cwd = guard.resolved;
    }

    // ⭐ 权限决策（exec 类）
    //   askWrites 档 → 只有命中高危特征才打断用户；
    //   askAll 档     → 每一条命令都逐条确认；
    //   readOnly 档   → 直接拒绝，命令根本不会执行。
    //   RISKY_PATTERNS 命中时只是把风险点写进摘要，让用户一眼看到为什么被拦。
    const risky = RISKY_PATTERNS.filter((r) => r.pattern.test(args.command));
    const danger = detectDangerousCommand(args.command);

    const notes = [
      danger ? `高危：${danger}` : null,
      ...risky.map((r) => `注意：${r.note}`),
    ].filter(Boolean);

    const decision = await approveToolCall({
      toolName: this.name,
      meta: this.meta,
      command: args.command,
      summary:
        (args.working_dir ? `$ cd ${args.working_dir}\n` : '') +
        `$ ${args.command}` +
        (notes.length ? `\n\n${notes.map((n) => '• ' + n).join('\n')}` : ''),
    });
    if (!decision.approved) {
      return {
        content:
          decision.reason ||
          '用户拒绝了这条命令的执行。不要重复请求，先向用户说明这条命令会做什么。',
        isError: true,
      };
    }

    if (args.signal?.aborted) {
      return { content: '[用户已中断，命令未执行]', isError: true };
    }

    // 用 spawn 而不是 exec：spawn 能真正 kill 子进程，exec 的超时只是父进程不等了，
    // 子进程还在后台跑（Windows 上尤其明显：pytest 会变成僵尸进程）
    return new Promise<ToolResult>((resolve) => {
      const isWin = process.platform === 'win32';
      const child = spawn(args.command, {
        cwd,
        shell: isWin ? 'cmd.exe' : '/bin/bash',
        windowsHide: true,
      });

      let out = '';
      let err = '';
      let settled = false;
      let truncated = false;

      const timer = setTimeout(() => {
        truncated = true;
        killChild();
      }, timeout);

      function killChild() {
        try {
          child.kill('SIGTERM');
          // Windows 上 SIGTERM 不一定生效，再补一刀 SIGKILL
          if (isWin) setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 500);
        } catch {}
      }

      const onAbort = () => {
        killChild();
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          args.signal?.removeEventListener('abort', onAbort);
          resolve({ content: '[用户中断了命令执行]', isError: true });
        }
      };
      args.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (d) => { out += d.toString(); });
      child.stderr?.on('data', (d) => { err += d.toString(); });

      child.on('error', (e: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        args.signal?.removeEventListener('abort', onAbort);
        resolve({ content: `命令执行失败: ${e.message}`, isError: true });
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        args.signal?.removeEventListener('abort', onAbort);

        const combined = format(out, err, code);
        // ⭐ 按长度截断（保留头尾），超时标记作为附加信息
        const timeoutNote = truncated ? `\n[⚠ 超时 ${timeout}ms，已终止进程]\n` : '';
        // ⭐ 敏感信息脱敏（2026-10-25）
        //   `cat .env` / `type .env.local` 这类命令的输出里带着密钥，
        //   一样会进上下文 —— 所以 shell 输出也要过一遍脱敏。
        const redactedOut = redactContent(
          combined,
          '',
          commandTouchesSensitiveFile(args.command),
        );
        const final = headTail(redactedOut.content, MAX_OUTPUT_CHARS, timeoutNote);

        resolve({
          content: final + redactionNotice(redactedOut.count),
          isError: truncated || undefined,
        });
      });
    });
  }
}

function format(stdout: string, stderr: string, code: number | null): string {
  let s = '';
  if (stdout) s += `STDOUT:\n${stdout}\n`;
  if (stderr) s += `STDERR:\n${stderr}\n`;
  // code 为 null = 进程被信号杀掉（超时/中断），不是"退出码 0"
  if (code === null) s += `\n[进程已被终止]\n`;
  else if (code !== 0) s += `\n[exit ${code}]\n`;
  return s.trim() || '(无输出)';
}

/**
 * 头尾保留截断（抄 goose 的 OUTPUT_PREVIEW 策略）
 * 开头 70% 给人看上下文，结尾 30% 保留报错信息
 */
function headTail(text: string, max: number, marker: string): string {
  // ⚠ 没超长时也必须保留 marker（超时提示就靠它，
  //   输出很短时最容易被漏掉）
  if (text.length <= max) return marker ? text + marker : text;

  const tailLen = Math.min(Math.floor(max * 0.3), 9000);
  const headLen = max - tailLen - marker.length - 20;

  const head = text.slice(0, headLen);
  const tail = text.slice(-tailLen);

  return (
    head +
    `\n\n[... 已省略中间 ${text.length - headLen - tailLen} 字符 ...\n` +
    `⚠ 保留末尾是因为报错信息通常在最后]\n\n` +
    tail +
    marker
  );
}