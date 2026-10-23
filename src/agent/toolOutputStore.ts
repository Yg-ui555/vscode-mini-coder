/**
 * 大工具输出外置（tool output offloading）
 *
 * ─────────────────────────────────────────────────────────────
 * 要解决的真实问题：为什么你的 token 花得那么凶
 * ─────────────────────────────────────────────────────────────
 *
 *   打开 eval/RESULTS.md 看一眼成本：
 *     输入 token  1,028,973
 *     输出 token     52,467
 *     输入是输出的 20 倍。
 *
 *   ReAct 循环的特性决定了这件事：每一步都要把"到目前为止的全部上下文"
 *   重新发给服务器。所以第 20 步的时候，前面 19 步读过的每个文件、
 *   每条命令输出，都已经被重复发送了 20 次。
 *
 *   类比：你要写一份很长的报告，每写一句就把整个草稿从头读一遍。
 *         写到第 50 句时，你已经把前 49 句读了 50 遍。
 *
 *   而单次工具输出有多大？
 *     read_file  → 最多 30,000 字符
 *     run_shell  → 最多 30,000 字符
 *     grep       → 大量匹配时同样很长
 *   读三个大文件，上下文瞬间几万 token，而这东西每轮都在重发。
 *
 * ─────────────────────────────────────────────────────────────
 * 解法：大内容落盘，对话里只留"预览 + 文件位置"
 * ─────────────────────────────────────────────────────────────
 *
 *   借鉴 nanobot 的 context_governance.py（超过 max_tool_result_chars
 *   就落盘，回灌时换成引用占位符）。nanobot 的阈值是 16000 字符，
 *   本项目取 8000 —— 因为 VS Code 插件的单轮更短，落盘更早收益更大。
 *
 *   关键设计：占位符里保留【一段预览】，不是只给一个文件路径。
 *
 *   为什么必须留预览：
 *     grep 出了 200 个匹配，LLM 需要看到匹配行才能判断"该去读哪个文件"。
 *     如果只给路径，它就得先把整个文件拉回来才能判断 —— 外置就白做了，
 *     甚至更贵（多一次工具往返）。
 *
 *   留 1500 字符预览的做法：
 *     · 上下文占用从 30000 降到 ~1800，省 94%
 *     · LLM 依然能做"接下来该干什么"的判断
 *     · 真需要细节时，用 read_file 带 offset/limit 精准取
 *
 *   为什么 read_file 这条路走得通：
 *     ReadFileTool 早就支持 offset / limit（见 readFile.ts:53），
 *     而且 .mini-coder/ 在工作区内，路径白名单放行。
 *     这个能力之前一直只能由 LLM 主动发起，现在我们主动指路。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么必须能在评测沙箱里关掉
 * ─────────────────────────────────────────────────────────────
 *
 *   和 checkpoint 被关掉是完全一样的理由（见 checkpoint/store.ts:83）：
 *     外置文件落在 sandbox/.mini-coder/tool-output/ 下，
 *     而 eval/types.ts 的 listFiles() 不忽略任何目录 ——
 *     这些文件会被算进"agent 改了哪些文件"。
 *     changedFiles 是 L4 回归检测的辅助证据，被污染就失去意义了。
 *
 *   更本质的原因：评测要回答的是"agent 能不能把代码改对"，
 *   外置回答的是"token 怎么花更省"。沙箱里算成本没有意义
 *   （评测的 token 统计来自 provider 上报的真实 usage，不是估算）。
 * ─────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getDefaultCwd } from './tools/paths';

/** 外置目录（相对工作区）。跟 checkpoint 同级，都在 .mini-coder 下。 */
export const TOOL_OUTPUT_DIR = '.mini-coder/tool-output';

/**
 * 超过多少字符才外置
 *
 * 取 8000 的理由：约等于 2500~3000 token。
 *   低于这个量级，外置省下的钱还不够抵一次额外工具调用的往返成本。
 *   （外置本身不花 LLM 调用，但 LLM 回头 read_file 是要花一轮的）
 */
export const EXTERNALIZE_THRESHOLD = 8000;

/** 占位符里保留多少字符的预览 */
const PREVIEW_CHARS = 1500;

/**
 * 最多保留多少个外置文件
 *
 * 超了删最旧的。为什么要限：
 *   一个长会话可能外置上百个文件，每个几 MB。不清理的话
 *   用户项目目录会被撑大，而且 .mini-coder 本来就该是可丢弃的缓存。
 */
export const MAX_STORED_OUTPUTS = 200;

/** 这些工具的输出天然很短，外置纯属浪费 */
const NEVER_EXTERNALIZE = new Set(['apply_patch', 'write_file', 'restore_file', 'record_note']);

/** 总开关（评测沙箱里关掉） */
let enabled = true;

export function setToolOutputEnabled(on: boolean): void {
  enabled = on;
}

export function isToolOutputEnabled(): boolean {
  return enabled;
}

export interface StoredOutput {
  /** 内容指纹（sha1 前 8 位），用于命名和去重 */
  id: string;
  /** 相对工作区的路径，LLM 直接可以用 read_file 读 */
  relPath: string;
  toolName: string;
  originalChars: number;
  lines: number;
  createdAt: string;
}

export interface ExternalizeResult {
  /** 回灌给 LLM 的内容（超阈值时是预览+指针，否则是原内容） */
  content: string;
  /** 外置成功时非 null */
  stored: StoredOutput | null;
}

/** 原子写：先写 .tmp 再 rename，中途崩溃不会留下半截文件 */
function atomicWrite(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 清理失败不致命 */
    }
    throw e;
  }
}

/**
 * 生成安全的文件名
 *
 * 用内容 sha1 做主键，好处：
 *   · 天然去重（同样的输出不会存两遍）
 *   · 不含任何用户可控的路径字符，天然免疫路径穿越
 *   · 长度固定，不会因为工具参数里有中文/斜杠而炸掉
 */
function outputId(toolName: string, content: string): string {
  const hash = crypto.createHash('sha1').update(content, 'utf-8').digest('hex').slice(0, 10);
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'tool';
  return `${safeTool}-${hash}`;
}

/** 外置目录绝对路径 */
function outputRoot(): string {
  return path.join(getDefaultCwd(), TOOL_OUTPUT_DIR);
}

/**
 * 清理超量的旧文件（超过 MAX_STORED_OUTPUTS 就删最旧的）
 *
 * 静默失败：清理是 housekeeping，不该影响主流程。
 */
function pruneOldFiles(): void {
  try {
    const dir = outputRoot();
    if (!fs.existsSync(dir)) return;

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .map((f) => {
        const full = path.join(dir, f);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          /* 文件可能刚被删，忽略 */
        }
        return { full, mtime };
      })
      .sort((a, b) => a.mtime - b.mtime); // 最旧的在前

    const toRemove = files.slice(0, Math.max(0, files.length - MAX_STORED_OUTPUTS));
    for (const f of toRemove) {
      try {
        fs.unlinkSync(f.full);
      } catch {
        /* 忽略 */
      }
    }
  } catch {
    /* 清理失败不影响主流程 */
  }
}

/**
 * 造预览
 *
 * 保头保尾：编译错误、测试失败报告在末尾，从头截断会把最关键的信息扔掉
 * （这个策略跟 runShell.ts 的 headTail 是同一套，理由也一样）。
 */
function buildPreview(content: string): string {
  if (content.length <= PREVIEW_CHARS) return content;

  const tailLen = Math.floor(PREVIEW_CHARS * 0.35);
  const headLen = PREVIEW_CHARS - tailLen - 60;

  return (
    content.slice(0, headLen) +
    `\n\n[... 中间 ${content.length - headLen - tailLen} 字符已省略 ...]\n\n` +
    `⚠ 保留末尾是因为报错信息通常在最后\n\n` +
    content.slice(-tailLen)
  );
}

/**
 * 主入口：判断一次工具输出要不要外置
 *
 * @param toolName 工具名
 * @param content  工具原始输出
 * @param _args    工具参数（预留：将来可用来给文件名加可读前缀）
 */
export function maybeExternalize(
  toolName: string,
  content: string,
  _args?: unknown,
): ExternalizeResult {
  // 总开关关闭（评测沙箱）
  if (!enabled) {
    return { content, stored: null };
  }

  // 天然短的工具直接放行
  if (NEVER_EXTERNALIZE.has(toolName)) {
    return { content, stored: null };
  }

  // 没超阈值，直接放行
  if (!content || content.length <= EXTERNALIZE_THRESHOLD) {
    return { content, stored: null };
  }

  const id = outputId(toolName, content);
  const relPath = `${TOOL_OUTPUT_DIR}/${id}.txt`;

  try {
    atomicWrite(path.join(getDefaultCwd(), relPath), content);
  } catch {
    // ⭐ 落盘失败【绝不能影响主流程】
    //   外置是个"优化"，不是"功能"。存不下就老老实实返回原内容，
    //   最坏结果只是多烧一点 token，不能因此让工具调用失败。
    return { content, stored: null };
  }

  const lines = content.split('\n').length;
  const stored: StoredOutput = {
    id,
    relPath,
    toolName,
    originalChars: content.length,
    lines,
    createdAt: new Date().toISOString(),
  };

  // 每 20 次触发一次清理，避免每次都 readdir（长会话里 readdir 不便宜）
  pruneCounter += 1;
  if (pruneCounter % 20 === 0) {
    pruneOldFiles();
  }

  return { content: formatPlaceholder(stored, content), stored };
}

/** 清理计数器（模块级，重启归零即可 —— 目录本身是持久的） */
let pruneCounter = 0;

/**
 * 造给 LLM 看的占位文本
 *
 * 写法上刻意用"祈使句 + 明确的下一步"，因为这段话的唯一读者是模型。
 * 之前踩过的坑：提示写得含糊，模型就真的会忽略它然后重新把大文件读一遍。
 */
function formatPlaceholder(stored: StoredOutput, original: string): string {
  return (
    `[输出过大，已外置到文件]\n\n` +
    `原始输出：${stored.originalChars} 字符 / ${stored.lines} 行，超过单次上下文预算 ${EXTERNALIZE_THRESHOLD} 字符。\n` +
    `完整内容路径：${stored.relPath}\n\n` +
    `以下是头尾预览（中间已省略）：\n\n` +
    `${buildPreview(original)}\n\n` +
    `——\n` +
    `如果上面预览已经够你判断，就不要把整个文件读回来。\n` +
    `如果需要具体某一段，用 read_file 读取 ${stored.relPath}，并带上 offset 和 limit 参数控制范围。\n` +
    `⚠ 不带 offset/limit 地读它会再次触发外置，白白多跑一轮。`
  );
}

/**
 * 清理当前会话的全部外置文件
 *
 * 什么时候用：
 *   · 新建会话时（旧的调试资料没用了）
 *   · 用户手动执行清理命令
 */
export function clearStoredOutputs(): number {
  try {
    const dir = outputRoot();
    if (!fs.existsSync(dir)) return 0;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt'));
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {
        /* 忽略 */
      }
    }
    return files.length;
  } catch {
    return 0;
  }
}

/**
 * 列出已外置的文件（/doctor 和调试用）
 */
export function listStoredOutputs(): StoredOutput[] {
  try {
    const dir = outputRoot();
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .map((f) => {
        const full = path.join(dir, f);
        let stat: fs.Stats | null = null;
        try {
          stat = fs.statSync(full);
        } catch {
          return null;
        }
        return {
          id: f.replace(/\.txt$/, ''),
          relPath: `${TOOL_OUTPUT_DIR}/${f}`,
          toolName: f.split('-')[0] || 'unknown',
          originalChars: stat.size,
          lines: 0,
          createdAt: stat.mtime.toISOString(),
        } as StoredOutput;
      })
      .filter((x): x is StoredOutput => x !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}