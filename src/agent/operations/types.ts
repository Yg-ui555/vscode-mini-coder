/**
 * Operation 管线 —— 类型定义
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 为什么要把主循环拆成"操作管线"
 *
 *   改造前，src/agent/loop.ts 是 1075 行的一整个 while 循环：
 *   上下文压缩、LLM 调用、工具分批并行、四个 Hook、中断处理、
 *   触顶收尾 —— 全挤在一个方法里。
 *
 *   它能跑，但它已经是个"什么都往里塞"的黑洞：
 *   加任何新能力都要先在 1000 行里找到地方，
 *   而且改错地方不会报错，只会静默地改坏行为。
 *
 *   借鉴 goose 的状态机（crates/goose-agent/src/machine.rs:121-190）：
 *   把主循环拆成一串 Operation，每个只干一件事，
 *   主循环本身只剩"按顺序跑这些操作"几十行。
 *
 *   三个直接收益：
 *     1. 新增能力 = 往数组里加一项，不用改主循环
 *     2. 每个 Operation 能单独单测（给它一个假上下文就行）
 *     3. 终止条件（中断 / 触顶 / Stop hook 拒绝）全部显式化
 *
 * ─────────────────────────────────────────────────────────────
 * 三种返回状态的语义
 *
 *   not_applicable  这一步这轮不需要做（跳过，继续下一个）
 *   applied         这一步做了事（继续往下走）
 *   yielded         任务结束了，最终输出就是 output（立刻终止整条管线）
 *
 *   ⚠️ 与 goose 的区别要说清楚：
 *     goose 是"第一个返回 Applied 的操作即停"（互斥语义，
 *     因为它那 18 个 Operation 里同一时刻只有一个适用）；
 *     本项目是"按顺序跑，每个不适用就跳过"（顺序语义）。
 *
 *   为什么选顺序语义：
 *     我们的流程里有【天然的前后依赖】——
 *     先压缩上下文、再调 LLM、再执行工具、最后判断能不能收工。
 *     顺序语义能原样表达这个依赖，而互斥语义要靠 ctx.state 绕。
 *
 *   但"新增能力 = 加一项"这个收益是一样的：
 *     数组的顺序就是执行顺序，一眼可见，不用读主循环。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么 Operation 必须是纯逻辑
 *
 *   Operation 不许碰 vscode API、不许直接读写文件。
 *   理由有三条，每条都对应一个真实收益：
 *     1. 它要能在评测沙箱里跑（src/eval/runner.ts 直接 new AgentLoop）
 *     2. 它要能在 vitest 里跑（不需要 mock 一整个 vscode 模块）
 *     3. 依赖方向单一 —— 谁污染了状态，一眼能看出来
 */

import { OpenAIProvider, TokenUsage, LLMResponse } from '../provider';
import { ToolRegistry, ToolResult } from '../tools/registry';

/**
 * 主循环的回调集合
 *
 * ⚠️ 这个类型原本定义在 loop.ts 里。搬到这儿是因为
 *    operations/ 下的每个文件都要用它，而 loop.ts 又要 import operations/ ——
 *    放一起会形成循环依赖。搬过来后 loop.ts 重新导出，外部调用方无感知。
 */
export interface AgentCallbacks {
  onText: (chunk: string) => void;
  onToolCall: (name: string, args: any) => void;
  /**
   * 工具执行结果回调
   *
   * ⚠️ args 是【可选】的第三个参数 —— 加它是为了让评测轨迹能回答
   *    "agent 到底跑了什么命令"这个问题。
   *    之前轨迹里 args 恒为空对象，导致消融实验只能看到"调了 35 次 run_shell"，
   *    却不知道跑的是 `ls` 还是 `grep`（后者会让消融结论完全反过来）。
   */
  onToolResult: (name: string, result: ToolResult, args?: any) => void;
  /** 上下文压缩事件回调 */
  onCompact?: (summary: string) => void;
  /** 上下文用量变化（用于 UI 显示"已用 12k / 64k"） */
  onUsage?: (current: number, window: number) => void;
  /** 本次任务的 token 开销（评测框架据此统计成本） */
  onTokenUsage?: (delta: TokenUsage, total: TokenUsage) => void;
  /**
   * 工具执行进度回调（中断续跑用）
   *
   * ⭐ 为什么 loop 只"报告"、不自己存盘：
   *   loop 是纯逻辑，不该知道会话、存储、vscode 这些东西
   *   （它还要能在评测沙箱和 vitest 里直接跑）。
   *   它只负责如实汇报"哪些工具做完了、哪些还没做"，
   *   至于存到哪、怎么存，由 ChatPanel 决定。
   *
   * ⭐ 为什么每完成一个工具就报一次（而不是一轮结束时才报）：
   *   一个真实的崩溃/关闭窗口是在"两个工具之间"。
   *   如果一轮结束才写 checkpoint，那么这一轮里已经执行完的工具
   *   在快照里会显示成"未执行"，恢复时会给它们补上假的"未执行"提示 ——
   *   而它们的副作用其实已经落地了，模型可能被误导再去执行一次。
   *   细粒度上报把这个窗口缩到最小。
   */
  onToolProgress?: (info: {
    iteration: number;
    done: Array<{ id: string; name: string }>;
    pending: Array<{ id: string; name: string }>;
    /** 本轮是否已全部执行完（或任务是否已结束） */
    finished: boolean;
  }) => void;
}

/** 跨 Operation 共享的可变状态 */
export interface OperationState {
  /**
   * 本轮 LLM 的最终响应
   *
   * inference Operation 写，toolExecution / stopHook 读。
   * 用它来表达"这次是干活还是收工"这个分支，
   * 而不用把分支塞回主循环。
   */
  lastResponse?: LLMResponse | null;
  /** 本次 run 累计的 token 用量（跨轮累加） */
  tokenTotal: TokenUsage;
  /**
   * ⭐ 本轮实际广告给 LLM 的工具清单
   *
   *   用来校验"模型不能调用这一轮没告诉它的工具"。
   *   见 operations/inference.ts 里的说明。
   */
  advertisedTools?: string[];
  /**
   * ⭐ 用户中途插话的队列（Phase 5.3）
   *
   * 空数组 = 没有插话。steerInject Operation 每轮取一次。
   */
  steeringQueue?: string[];
  /**
   * ⭐ 当前待办清单（Phase 5.1）
   *
   * todoInject Operation 每轮重建一条 system 消息。
   */
  todos?: Array<{ content: string; status: string; activeForm?: string }>;
}

export interface OperationContext {
  /** 当前对话（会被 Operation 原地修改 —— 追加消息、打标记等） */
  messages: any[];
  /** 中断信号（用户点"停止"） */
  signal?: AbortSignal;
  /** 上层回调 */
  callbacks: AgentCallbacks;
  /** 当前轮次（从 0 开始） */
  iteration: number;
  /** LLM 客户端 */
  provider: OpenAIProvider;
  /** 工具注册表 */
  registry: ToolRegistry;
  /** 模型名（决定上下文窗口大小） */
  model: string;
  /** 上下文窗口上限（token） */
  contextWindow: number;
  /** 最大迭代轮数 */
  maxIterations: number;
  /** 跨 Operation 共享状态 */
  state: OperationState;
}

export type OperationResult =
  | { status: 'not_applicable' }
  | { status: 'applied' }
  | { status: 'yielded'; output: string };

export interface Operation {
  /** 操作名（会打进日志，方便定位是哪一步出的问题） */
  readonly name: string;
  run(ctx: OperationContext): Promise<OperationResult>;
}

/** 便捷构造：这一轮不适用 */
export const notApplicable = (): OperationResult => ({ status: 'not_applicable' });
/** 便捷构造：做了事 */
export const applied = (): OperationResult => ({ status: 'applied' });
/** 便捷构造：任务结束 */
export const yielded = (output: string): OperationResult => ({ status: 'yielded', output });
