/**
 * Agent 主循环 —— ReAct 范式
 *
 * ReAct = Reasoning + Acting（思考-行动循环）。
 * 类比：LLM 是一个只能看说明书、不能动手的助手。
 *       每轮它说"我要用哪个工具、参数是什么"，我们替它执行，
 *       把执行结果贴回去，它再决定下一步 —— 如此循环直到它说"做完了"。
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐⭐ 2026-10-26 重大改造：主循环管线化
 *
 *   改造前：这个文件 1075 行，一个 while 循环里塞着
 *   上下文压缩、LLM 调用、工具分批并行、四个 Hook、中断处理、触顶收尾。
 *   它能跑，但它已经是个"什么都往里塞"的黑洞。
 *
 *   改造后：主循环只剩【按顺序跑一串 Operation】几十行，
 *   每个 Operation 只干一件事，放在 src/agent/operations/ 下。
 *
 *   三个直接收益：
 *     1. 新增能力 = 往管线数组里加一项，不用改主循环
 *     2. 每个 Operation 能单独单测（给它一个假上下文就行）
 *     3. 终止条件（中断 / 触顶 / Stop hook 拒绝）全部显式化
 *
 *   借鉴来源：goose 的状态机
 *     · crates/goose-agent/src/operation.rs:80-138（Operation 契约）
 *     · crates/goose-agent/src/machine.rs:121-190（状态机本体，只有 20 行）
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 行为必须完全保持一致
 *
 *   这次是【纯重构】，不是改需求。
 *   管线化的顺序是照着原来 while 循环的顺序 1:1 搬过去的：
 *
 *     原 while 循环里的顺序          →  管线里的位置
 *     ────────────────────────────────────────────────
 *     if (aborted) return            →  abort
 *     （for 条件 iteration < max）    →  max_iterations
 *     runUserPromptSubmitHook        →  user_prompt_submit（只在第 0 轮）
 *     maybeCompact                   →  context_guard
 *     provider.stream                →  inference
 *     if (toolCalls) 执行工具        →  tool_execution
 *     else { stopHook; return }      →  stop_hook
 *     （循环外）触顶收尾              →  max_iterations 的 yield 分支
 *
 *   验收标准：474 个测试一个不改全部通过 + 评测结果不变。
 *   ⚠️ 如果你在重构时顺手改了行为，重构就变成了"边重构边改需求" ——
 *      出问题时你分不清是哪个引起的。
 *
 * ─────────────────────────────────────────────────────────────
 * 算法
 *
 *   1. 把 system prompt + 历史 + 用户最新输入丢给 LLM
 *   2. LLM 要么返回文本（任务完成），要么返回 tool_calls（要干活）
 *   3. 如果是 tool_calls，挨个执行，把结果塞回 messages
 *   4. 回到第 1 步继续问 LLM
 *   5. 直到 LLM 不再返回 tool_calls，说明任务完成
 *
 * 关键设计：
 * - maxIterations 上限（防 LLM 死循环）
 * - ⭐ AbortSignal 中断 —— 用户点"停止"能立刻停，且会杀掉正在跑的 shell 子进程
 * - ⭐ 触顶强制收尾 —— 达到 maxIterations 时，不是甩一句"超限了"就走，
 *   而是发起一次【不带工具】的请求，让 LLM 把已经做的工作总结给用户。
 *   （借鉴 nanobot runner.py:1168 的 _try_finalize_after_max_iterations）
 * - 流式回调（用户实时看到 LLM 在想什么）
 * - ⭐ autocompact（自动压缩上下文）
 *
 * ─────────────────────────────────────────────────────────────
 * 关于 autocompact 的真实借鉴来源（2026-10-21 修正过的注释）
 *
 *   ❌ 之前注释写"借鉴自 nanobot/autocompact.py"——不准确。
 *      读 nanobot 源码后发现：它的 autocompact.py 是
 *      「空闲 15 分钟就归档会话」的定时任务，属于省 token 的后台机制，
 *      跟"上下文太长要压缩"是两回事。
 *
 *   ✅ 真正的超阈值压缩在 nanobot/context_governance.py，
 *      思路来自那里的 compact_messages 机制。
 *
 * ── 与 nanobot 的剩余差距 ──────────────────────────────────
 *
 *   1) 【summary 落盘】—— 会话持久化已实现，见 session/store.ts
 *
 *   2) 【visibility flag 而非原地重排】
 *      goose 的做法（context_mgmt/mod.rs:89-226）：压缩时不删任何消息，
 *      只翻 agentVisible 标记 —— 摘要对模型可见、原文对模型不可见但用户
 *      仍能在 UI 里滚动查看。✅ 已完成（见 src/agent/visibility.ts）
 *
 *   3) 【历史自愈】—— ✅ 已完成（2026-10-22）
 *      见 util/historyRepair.ts。除了自愈，本项目还多做了一层：
 *      中断时直接补齐【剩余全部】tool_call（治本），
 *      autocompact 时把 assistant+tool 当整体保护（防患）。
 *
 *   4) 【重复工具调用检测】—— ✅ 已完成，见 agent/tools/repeatGuard.ts
 *      四重校验（参数一致 / 文件内容未变 / 原结果仍在上下文里 / 写后失效）
 */

import { OpenAIProvider } from './provider';
import { ToolRegistry } from './tools/registry';
import { contextWindowFor, DEFAULT_CONTEXT_WINDOW } from '../util/tokens';
import { MAX_ITERATIONS } from './limits';
import { resetGuard } from './tools/repeatGuard';
import { getHookManager } from './hooks/manager';
import { setDelegateRuntime } from './tools/delegate';
import { getSteeringQueue } from './steering';
import { buildPipeline } from './operations';
import { Operation, OperationContext, AgentCallbacks } from './operations/types';

// ── 兼容性再导出 ────────────────────────────────────────────
//
// 下面这几个符号原本定义在本文件里。搬走之后这里重新导出，
// 外部调用方（src/__tests__/phase1Features.test.ts 等）完全无感知。
export { filterForModel, refreshVisibleCallIds } from './visibility';
export { partitionToolCalls, ToolCallBatch } from './tools/partition';
export type { AgentCallbacks };

export class AgentLoop {
  /** 本次会话的上下文窗口上限（token 数） */
  readonly contextWindow: number;

  /** ⭐ 操作管线 —— 顺序就是执行顺序 */
  private readonly pipeline: Operation[];
  private readonly provider: OpenAIProvider;
  private readonly registry: ToolRegistry;
  private readonly maxIterations: number;
  private readonly model: string;

  constructor(
    provider: OpenAIProvider,
    registry: ToolRegistry,
    maxIterations = MAX_ITERATIONS,
    model = '',
  ) {
    this.provider = provider;
    this.registry = registry;
    this.maxIterations = maxIterations;
    this.model = model;
    this.contextWindow = contextWindowFor(model) || DEFAULT_CONTEXT_WINDOW;
    this.pipeline = buildPipeline();

    // ⭐ 把 provider / model / AgentLoop 交给 delegate 工具
    //
    //   子智能体需要用同一个 provider 跑（它是个独立 session，不是独立账号）。
    //   嵌套深度在这里【不】重置 —— delegate 工具自己管深度计数。
    //
    //   ⭐ 为什么还要把 AgentLoop【自己】也传进去：
    //     delegate 要给子 agent 造一个新的 AgentLoop（不同的工具集、
    //     不同的 maxTurns、不同的 system prompt）。
    //     如果 delegate 直接 import loop.ts，就形成了循环依赖：
    //       loop.ts → operations → toolExecution → tools/delegate → loop.ts
    //     之前用 `require()` 懒加载躲开，代价是 vitest 里直接解析不了
    //     （Node 的 CJS 解析器不认 .ts）。
    //     现在改成【主人把梯子递给它】，依赖方向单向，测试也能跑。
    setDelegateRuntime({ provider, model, AgentLoopCtor: AgentLoop });
  }

  /**
   * 跑一轮 agent 循环
   * 返回最终文本（任务完成时）
   */
  async run(
    messages: any[],
    signal: AbortSignal | undefined,
    callbacks: AgentCallbacks,
  ): Promise<string> {
    // ⭐ 重复调用检测：每次 run 从零开始计数
    //   （"结果是否还在上下文里"是跟本次会话绑定的，换任务必须重算）
    resetGuard();

    // ⭐ Stop hook 的连续阻断计数也归零（换任务重新算）
    getHookManager().resetStopBlocks();

    const ctx: OperationContext = {
      messages,
      signal,
      callbacks,
      iteration: 0,
      provider: this.provider,
      registry: this.registry,
      model: this.model,
      contextWindow: this.contextWindow,
      maxIterations: this.maxIterations,
      state: {
        // ⭐ 累计 token 用量。一次任务通常十几轮 LLM 调用，
        //   每轮都要发一遍完整上下文，所以 prompt token 是大头。
        tokenTotal: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        // ⭐ 插话队列 —— 跟面板共享【同一个数组引用】，
        //   所以面板 push 进来的话，steerInject Operation 能直接取到。
        steeringQueue: getSteeringQueue().pending,
      },
    };

    // ⭐ 主循环本体 —— 只有这么多
    //
    //   每个 Operation 按顺序跑：
    //     · not_applicable → 这轮不适用，跳过
    //     · applied        → 做了事，继续
    //     · yielded        → 任务结束，output 就是最终结果
    //
    //   循环一定会在 max_iterations 那个 Operation 里终止，
    //   所以不存在死循环（inference 每次都会真的发一次请求）。
    while (true) {
      for (const op of this.pipeline) {
        const result = await op.run(ctx);
        if (result.status === 'yielded') {
          return result.output;
        }
      }
      ctx.iteration++;
    }
  }
}
