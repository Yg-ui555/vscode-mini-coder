/**
 * Hook 机制 —— 类型定义与配置格式
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 这套机制解决什么问题
 *
 * 原来的「自动跑测试」是一条【写死的链路】：
 *   FileSystemWatcher → 防抖 → 找相关测试 → 跑 → 提示 AI 修
 *   （见 src/features/autoTest.ts）
 *
 * 这条链路只能做"保存文件后自动跑测试"这一件事。
 * 想加"改完自动跑 lint"、"提交前检查"、"读文件前脱敏"，
 * 都得去改 autoTest.ts —— 加一个功能就多一处硬编码。
 *
 * Hook 机制把它升级成【平台能力】：
 *   4 个生命周期点 + 声明式配置，用户自己写 hooks.json 就能定制工作流。
 *   内置的自动测试，只是这套机制的第一个消费者。
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 只做 4 个点，不做 12 个
 *
 * 参照 goose（crates/goose/src/hooks/mod.rs:55-68）的 12 个生命周期点，
 * 我们只做最有价值的 4 个：
 *
 *   | Hook              | 时机         | 能阻断吗 | 用途                       |
 *   |-------------------|--------------|----------|----------------------------|
 *   | PreToolUse        | 工具调用前   | ✅ 能    | 否决危险操作（可叠加审批）  |
 *   | PostToolUse       | 工具调用后   | ❌ 不能  | 通知 / 副作用（格式化等）  |
 *   | Stop              | 回合结束前   | ✅ 能    | 测试没过就不许收工          |
 *   | UserPromptSubmit  | 用户发消息后 | ❌ 不能  | 注入上下文（分支、待办）    |
 *
 * 为什么只做 4 个：
 *   每多一个点，配置格式、文档、测试、边界处理都要跟着涨。
 *   "宁可少做，不可半途" —— 做 4 个能用的，远好过做 12 个半成品的。
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 三条铁律（违反其中任何一条，hook 就成了不稳定的外挂）
 *
 * 1. 【hook 自身出错永远不阻断主流程】
 *    脚本不存在、崩了、超时 —— 只记日志，绝不阻断 agent。
 *    只有 hook 【明确返回非 0 退出码】才算"否决"。
 *    理由：hook 是用户自己写的脚本，它挂了不代表任务该失败。
 *
 * 2. 【只有两个点能阻断】
 *    PreToolUse（否决工具调用）和 Stop（拒绝结束回合）。
 *    另外两个点只能"说两句"，不能"卡住"。
 *
 * 3. 【Stop 的连续阻断有上限】
 *    默认 8 次（抄 goose 的 agent.rs:58）。
 *    理由：模型可能陷入"改一版 → 测试还是挂 → 再改一版"的死循环，
 *    没有上限就是无限烧钱。
 */

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'Stop' | 'UserPromptSubmit';

/** 全部支持的事件（顺序 = 执行优先级） */
export const HOOK_EVENTS: HookEvent[] = [
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'UserPromptSubmit',
];

/** 能阻断的事件 —— 只有这两个 */
export const BLOCKING_EVENTS: HookEvent[] = ['PreToolUse', 'Stop'];

/** 一条 hook 命令 */
export interface HookCommand {
  /** 目前只支持 command（子进程） */
  type: 'command';
  /** 要执行的命令行 */
  command: string;
  /** 超时（毫秒），默认 10 秒 */
  timeoutMs?: number;
}

/**
 * 一组 hook
 *
 * matcher 是正则：
 *   · PreToolUse / PostToolUse → 匹配【工具名】（如 "write_file|apply_patch"）
 *   · Stop / UserPromptSubmit → 匹配【事件主体】（Stop 是 agent 最后那段话，
 *     UserPromptSubmit 是用户这次输入）
 * 省略 matcher = 匹配全部。
 */
export interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}

/** hooks.json 的完整结构 */
export interface HooksFile {
  hooks?: Partial<Record<HookEvent, HookEntry[]>>;
}

/** 一次 hook 调用的输入（会作为 JSON 传给子进程的 stdin） */
export interface HookInvocation {
  event: HookEvent;
  /** 工作目录 */
  cwd: string;
  /** 工具名（PreToolUse / PostToolUse） */
  tool?: string;
  /** 工具参数 */
  arguments?: Record<string, unknown>;
  /** 工具结果（PostToolUse） */
  result?: { content: string; isError?: boolean };
  /** agent 准备收工时说的最后一段话（Stop） */
  response?: string;
  /** 用户这次输入的话（UserPromptSubmit） */
  prompt?: string;
  /** 当前是第几轮 */
  iteration?: number;
}

/** 一次 hook 执行的结果 */
export interface HookOutcome {
  /** 是否阻断 */
  blocked: boolean;
  /** 阻断理由（要回给模型看，所以必须是模型能理解的话） */
  reason?: string;
  /** hook 的标准输出（注入上下文 / 回给模型） */
  output?: string;
  /**
   * ⭐ 执行过程中的问题（脚本不存在、超时、崩了……）
   *
   * ⚠️ 这个字段存在就代表【不阻断】。
   *   hook 自己出问题 ≠ 任务该失败。
   */
  problem?: string;
}

/** 默认超时 */
export const DEFAULT_HOOK_TIMEOUT_MS = 10_000;

/** Stop 连续阻断上限（抄 goose agent.rs:58） */
export const MAX_STOP_BLOCKS = 8;
