/**
 * Token 计数 —— 判断上下文还能不能再塞进去
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么不能直接数字符（这是原来 loop.ts 的做法）
 *
 *   原代码：const COMPACT_THRESHOLD_CHARS = 80_000
 *   理由是"中文按 1 char ≈ 1 token 估算"。
 *
 *   但 token 不是字符。粗略的经验换算：
 *     纯英文   1 token ≈ 4 个字符
 *     纯中文   1 token ≈ 1~1.5 个汉字
 *     代码     1 token ≈ 2~3 个字符（符号多，比英文短）
 *
 *   也就是说，同样 80000 字符：
 *     全是英文  ≈ 20000 token
 *     全是中文  ≈ 60000 token
 *     混排代码  ≈ 30000 token
 *
 *   误差能到 3 倍。后果是双向的、都很糟：
 *     估少了 → 还没到上限就压缩，白白丢历史、白花钱
 *     估多了 → 超了才压缩，直接被 API 400 拒绝，整轮对话崩掉
 *
 * ─────────────────────────────────────────────────────────────
 * 三级降级（借鉴 nanobot 的 utils/helpers.py:852 estimate_prompt_tokens_chain）
 *
 *   1. provider 自己报的 usage —— 最准，但只有请求之后才知道，
 *      只能用来校准，不能用来在请求前预判。
 *   2. 精确 tokenizer —— 最理想，但要引第三方库（gpt-tokenizer 约 1MB）。
 *      本项目暂时不引，保持零依赖。
 *   3. 分语言启发式估算 —— 本文件实现，按中英文分别计算，
 *      比"总字符数"精确得多，且零依赖、跨 provider 通用。
 *
 * 如果以后要引精确 tokenizer，只需要替换 estimateTokens 的内部实现，
 * 对外接口不变。
 * ─────────────────────────────────────────────────────────────
 */

/** 英文/代码的换算：1 token ≈ 多少字符 */
const CHARS_PER_TOKEN_LATIN = 3.6;

/** 中日韩字符的换算：1 token ≈ 多少字符 */
const CHARS_PER_TOKEN_CJK = 1.4;

/** 单个 message 的固定开销（role、tool_call_id 等元数据的 token 成本） */
const PER_MESSAGE_OVERHEAD = 4;

/** tool schema 的粗略固定开销 */
const PER_TOOL_OVERHEAD = 12;

/** 判断是否中日韩字符（含扩展区，避开 emoji 干扰） */
function isCJK(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (
    (c >= 0x4e00 && c <= 0x9fff) || // CJK 统一表意文字
    (c >= 0x3400 && c <= 0x4dbf) || // 扩展 A
    (c >= 0x3040 && c <= 0x30ff) || // 日文假名
    (c >= 0xac00 && c <= 0xd7af) // 韩文音节
  );
}

/**
 * 估算一段文本的 token 数
 *
 * 分中英文分别计算再相加 —— 这是零依赖前提下能拿到的最好精度。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let cjk = 0;
  let latin = 0;

  for (const ch of text) {
    if (isCJK(ch)) cjk++;
    else latin++;
  }

  return Math.ceil(cjk / CHARS_PER_TOKEN_CJK + latin / CHARS_PER_TOKEN_LATIN);
}

/** 估算任意 JSON 结构的 token 数（工具参数等） */
function estimateJsonTokens(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return estimateTokens(value);
  if (typeof value === 'number' || typeof value === 'boolean') return 1;
  try {
    return estimateTokens(JSON.stringify(value));
  } catch {
    return 0;
  }
}

export interface MessageLike {
  role: string;
  content?: string | unknown;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

/**
 * 估算整个消息列表的 token 数
 *
 * @param messages 对话历史
 * @param tools    工具 schema（每次请求都要重发，也是固定成本）
 */
export function estimateMessagesTokens(
  messages: MessageLike[],
  tools?: Array<{ type: string; function: any }>,
): number {
  let total = 0;

  for (const m of messages) {
    total += PER_MESSAGE_OVERHEAD;
    total += estimateJsonTokens(m.content);
    total += m.role === 'system' ? estimateTokens(m.role) : 0;
    if (m.tool_calls && m.tool_calls.length > 0) {
      total += estimateJsonTokens(m.tool_calls);
    }
  }

  if (tools && tools.length > 0) {
    for (const t of tools) {
      total += PER_TOOL_OVERHEAD + estimateJsonTokens(t);
    }
  }

  return total;
}

/** 各家模型的上下文窗口（取一个偏保守的值） */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,
  'MiniMax-M3': 128_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'qwen2.5-coder:7b': 32_768,
};

export const DEFAULT_CONTEXT_WINDOW = 64_000;

/** 按模型名猜上下文窗口；不认识就用保守默认值 */
export function contextWindowFor(model: string): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW;
  // 精确匹配
  if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model];
  // 前缀匹配（模型名常带日期后缀，如 gpt-4o-2024-08-06）
  for (const key of Object.keys(MODEL_CONTEXT_WINDOWS)) {
    if (model.startsWith(key)) return MODEL_CONTEXT_WINDOWS[key];
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/** 生成人类可读的上下文用量文案 */
export function formatUsage(current: number, window: number): string {
  const pct = Math.round((current / window) * 100);
  const bar = '█'.repeat(Math.min(20, Math.floor(pct / 5))).padEnd(20, '░');
  return `${(current / 1000).toFixed(1)}k / ${(window / 1000).toFixed(0)}k tokens  ${bar} ${pct}%`;
}
