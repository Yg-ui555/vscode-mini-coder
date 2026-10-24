/**
 * Agent 主循环 - ReAct 范式
 *
 * ReAct = Reasoning + Acting（思考-行动循环）。
 * 类比：LLM 是一个只能看说明书、不能动手的助手。
 *       每轮它说"我要用哪个工具、参数是什么"，我们替它执行，
 *       把执行结果贴回去，它再决定下一步 —— 如此循环直到它说"做完了"。
 *
 * 算法：
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
 * 关于 autocompact 的真实借鉴来源（修正之前的错误注释）：
 *
 *   ❌ 之前注释写"借鉴自 nanobot/autocompact.py"——不准确。
 *      读 nanobot 源码后发现：它的 autocompact.py 是
 *      「空闲 15 分钟就归档会话」的定时任务，属于省 token 的后台机制，
 *      跟"上下文太长要压缩"是两回事。
 *
 *   ✅ 真正的超阈值压缩在 nanobot/context_governance.py，
 *      本文件的思路来自那里的 compact_messages 机制。
 *
 * ── 2026-10-21 加固后，与 nanobot 的剩余差距 ────────────────────
 *
 *   1) 【summary 落盘】—— 会话持久化已实现，见 session/store.ts
 *
 *   2) 【visibility flag 而非原地重排】
 *      goose 的做法（context_mgmt/mod.rs:89-226）：压缩时不删任何消息，
 *      只翻 agentVisible 标记 —— 摘要对模型可见、原文对模型不可见但用户
 *      仍能在 UI 里滚动查看。好处是"用户看到的"和"模型看到的"解耦。
 *      当前实现是原地重排 messages，用户看不到被压缩掉的历史。
 *      这是下一步的优化方向（需要 Webview 侧配合渲染历史）。
 *
 *   3) 【历史自愈】—— ✅ 已完成（2026-10-22）
 *      见 util/historyRepair.ts。除了自愈，本项目还多做了一层：
 *      中断时直接补齐【剩余全部】tool_call（治本），
 *      autocompact 时把 assistant+tool 当整体保护（防患）。
 *      原因见下面两处的详细注释 —— 这两处都是真实会导致 provider 400 的
 *      结构缺陷，不是理论隐患。

 *   4) 【重复工具调用检测】—— ❌ 还没做
 *      评测报告（eval/RESULTS.md）显示 18 道题里 7 道出现同一工具重复调用 ≥5 次，
 *      这是当前 token 成本的主要来源（输入 token 是输出的 20 倍）。
 *      goose 和 nanobot 都没做，是可以做差异化的点。
 * ─────────────────────────────────────────────────────────────
 */

import { OpenAIProvider, TokenUsage } from './provider';
import { ToolRegistry, ToolResult } from './tools/registry';
import { estimateMessagesTokens, contextWindowFor, DEFAULT_CONTEXT_WINDOW } from '../util/tokens';
import { maybeExternalize } from './toolOutputStore';
import { MAX_ITERATIONS } from './limits';
import { info } from '../logger';
import { resetGuard, setVisibleCallIds, getGuard } from './tools/repeatGuard';

/**
 * ⭐ 双可见性：过滤出「模型可见」的消息
 *
 *   借鉴 goose 的两个投影函数：
 *     · agent_visible_content() —— 喂给模型的（goose message.rs:985）
 *     · user_visible_content()  —— 喂给 UI 的（goose message.rs:998）
 *
 *   ⚠️⚠️ 这是整个双可见性改造里最关键的一行：
 *     如果只是给消息打 agentVisible=false 标记、但请求时照样全量发送，
 *     那 token 一分钱都没省，而且模型会看到一堆互相矛盾的历史
 *     （摘要说"我们改完了"，但下面还挂着没被压掉的原始对话）。
 *
 *   所以：每次请求前必须过滤。
 *
 *   同时算一遍「当前可见的 tool_call_id 集合」，
 *   供重复检测的第四重校验使用。
 */
export function filterForModel(messages: any[]): any[] {
  return messages.filter((m) => m?.agentVisible !== false);
}

/**
 * 重算「当前上下文里模型还看得见的 tool_call_id 集合」
 *
 *   重复检测的第四重校验依赖它：
 *     只有当上次的工具结果【还在模型上下文里】时，
 *     才敢返回「文件没变」的提示；否则必须老老实实重读。
 *
 *   注意：这里扫的是【过滤后】的 messages ——
 *   被隐藏的消息模型看不见，所以它们的结果也不算「可见」。
 */
export function refreshVisibleCallIds(messages: any[]): void {
  const ids = new Set<string>();
  for (const m of filterForModel(messages)) {
    if (m?.role === 'tool' && typeof m.tool_call_id === 'string') {
      ids.add(m.tool_call_id);
    }
  }
  setVisibleCallIds(ids);
}

/**
 * ⭐ 工具调用批次：一批内的工具可以并行执行
 */
export interface ToolCallBatch {
  calls: Array<{ id: string; name: string; arguments: string }>;
  /** 这一批能否并行 */
  parallel: boolean;
}

/**
 * 按安全性把 tool_calls 分批
 *
 * 借鉴 nanobot/agent/tools/execution.py:294-318 的 _partition_tool_batches。
 *
 * 分批规则（从安全到危险）：
 *   1. 只读工具（read / grep / glob / list_dir）→ 一批，可并行
 *      它们没有任何副作用，互不干扰。
 *   2. 写工具（apply_patch / write_file / restore_file）→ 各自单独一批，串行
 *      两个 patch 同时改同一个文件会互相覆盖；
 *      而且它们要弹审批窗，两个弹窗同时弹会让用户懵。
 *   3. 执行工具（run_shell）→ 单独一批，串行
 *      命令的副作用在 agent 控制之外，必须一个个来。
 *
 * ⚠️ 关键：批次的【顺序】必须跟原始 tool_calls 顺序一致。
 *   因为回填结果时 messages.push 的顺序决定协议合法性
 *   （tool_call_id 与 tool 消息必须一一对应且紧邻）。
 *
 * @param toolCalls LLM 返回的原始 tool_calls 数组
 * @param registry  工具注册表（用来查每个工具的 meta）
 */
export function partitionToolCalls(
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
  registry: ToolRegistry,
): ToolCallBatch[] {
  const batches: ToolCallBatch[] = [];
  let readBatch: ToolCallBatch | null = null;

  for (const tc of toolCalls) {
    const tool = registry.get(tc.name);
    const meta = tool?.meta;

    // ⭐ 判定依据：既看「只读」，也看「可并发」
    //
    //   concurrentSafe 这个字段在本项目定义了却从没被用过
    //   （tools/meta.ts:48-52）。这次把它接上。
    //
    //   为什么要两个字段？
    //     readOnly      = 有没有副作用（决定要不要审批、要不要 checkpoint）
    //     concurrentSafe = 能不能和别的工具同时跑（决定要不要并行）
    //
    //   理论上"只读"必然"可并发"，但反过来不成立：
    //     未来的某个工具可能「有副作用但可并发」
    //     （比如往两个不同文件写 —— 各自独立，不会互相覆盖）。
    //     现在的实现里两者等价，是刻意的保守选择：
    //     宁可少并行，也不要引入一类"看起来能并行其实会打架"的 bug。
    //
    //   ⚠️ 拿不到 meta 的工具（未注册）→ 按【不可并行】处理。
    //     未知工具的副作用范围是未知的，保守是对的。
    const isReadOnly = meta?.readOnly === true || meta?.kind === 'read';
    const canRunConcurrently = meta?.concurrentSafe === true;

    if (isReadOnly && canRunConcurrently) {
      // 只读且可并发 → 都进同一个并行批次
      if (!readBatch) {
        readBatch = { calls: [], parallel: true };
        batches.push(readBatch);
      }
      readBatch.calls.push(tc);
      continue;
    }

    // 其余（写 / 执行 / 元数据缺失）→ 各自单独一批，串行
    // 为什么要单独一批而不是把所有写工具放一起：
    //   · 两个 apply_patch 改同一个文件 → 互相覆盖
    //   · checkpoint 快照会乱（一次调用一个快照的语义被破坏）
    //   · 审批弹窗同时弹，用户懵
    batches.push({ calls: [tc], parallel: false });
    readBatch = null;
  }

  return batches;
}

export interface AgentCallbacks {
  onText: (chunk: string) => void;
  onToolCall: (name: string, args: any) => void;
  onToolResult: (name: string, result: ToolResult) => void;
  onCompact?: (summary: string) => void;  // ← 新增：压缩事件回调
  /** 上下文用量变化（用于 UI 显示"已用 12k / 64k"） */
  onUsage?: (current: number, window: number) => void;
  /** ⭐ 本次任务的 token 开销（评测框架据此统计成本） */
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

/**
 * 压缩触发阈值：占上下文窗口的比例
 *
 * 借鉴 goose：crates/goose/src/context_mgmt/mod.rs:243 的
 * check_if_compaction_needed 用 usage_ratio > 0.7 触发，默认 0.7。
 * 留 30% 余量是因为一次工具调用可能就要塞进几万 token 的结果，
 * 压到刚好卡线再触发就晚了。
 */
const COMPACT_THRESHOLD_RATIO = 0.7;

/**
 * 压缩后至少保留最近多少条【对话】消息
 *
 * ⚠️ 2026-10-21 修复：原来这里是"保留最近 6 条【所有】消息"。
 *   长工具链跑起来后，最近 6 条很可能正好把「上一步 apply_patch 的结果」
 *   挤出去 → LLM 看不见自己刚改了什么 → 重复改同一个文件。
 *
 *   现在改成两条规则叠加：
 *     1. 永远保住所有 tool 消息（哪怕它很靠前）—— 它们是"我干了什么"的唯一记录
 *     2. 对话消息至少保留最近 KEEP_RECENT_MESSAGES 条
 */
const KEEP_RECENT_MESSAGES = 12;

export class AgentLoop {
  /** 本次会话的上下文窗口上限（token 数） */
  readonly contextWindow: number;

  constructor(
    private provider: OpenAIProvider,
    private registry: ToolRegistry,
    private maxIterations = MAX_ITERATIONS,
    model = '',
  ) {
    this.contextWindow = contextWindowFor(model) || DEFAULT_CONTEXT_WINDOW;
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
    // ⭐ 累计 token 用量。一次任务通常十几轮 LLM 调用，
    //   每轮都要发一遍完整上下文，所以 prompt token 是大头。
    const tokenTotal: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // ⭐ 重复调用检测：每次 run 从零开始计数
    //   （"结果是否还在上下文里"是跟本次会话绑定的，换任务必须重算）
    resetGuard();

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      // ⭐ 每轮前检查用户是否点了"停止"
      if (signal?.aborted) return this._abortedResult(messages);

      // ⭐ 每轮前检查是否需要 autocompact
      await this.maybeCompact(messages, signal, callbacks);

      // ⭐ 刷新「模型可见的 tool_call_id 集合」
      //   重复检测的第四重校验依赖它。
      //   每轮都刷（而不是只在压缩后刷），因为工具结果会不断新增。
      refreshVisibleCallIds(messages);

      let finalResponse: any = null;

      // ⭐⭐ 双可见性：发给 provider 的必须是【过滤后】的消息
      //
      //   被压缩掉的原始对话（agentVisible=false）不再重发，
      //   只有摘要 + 受保护的 tool 记录 + 最近的消息会发出去。
      //   这就是 token 下降的来源。
      //
      //   ⚠️ 注意 estimateMessagesTokens 也要用过滤后的结果算，
      //   否则 UI 上的"上下文用量"显示的是含隐藏消息的虚高数字。
      const modelMessages = filterForModel(messages);

      for await (const chunk of this.provider.stream(modelMessages, this.registry.schemas, signal)) {
        if (chunk.isFinal && chunk.finalResponse) {
          finalResponse = chunk.finalResponse;
          // ⭐ 累加本轮 usage（流末尾那个 chunk 才有）
          if (chunk.usage) {
            tokenTotal.promptTokens += chunk.usage.promptTokens;
            tokenTotal.completionTokens += chunk.usage.completionTokens;
            tokenTotal.totalTokens += chunk.usage.totalTokens;
            callbacks.onTokenUsage?.(chunk.usage, { ...tokenTotal });
          }
        } else if (chunk.content) {
          callbacks.onText(chunk.content);
        }
      }

      if (signal?.aborted) return this._abortedResult(messages);
      if (!finalResponse) return '[错误] LLM 未返回有效响应';

      // 情况 1：LLM 返回文本（任务完成）
      if (finalResponse.toolCalls.length === 0) {
        if (finalResponse.content) {
          messages.push({ role: 'assistant', content: finalResponse.content });
        }
        // ⭐ 整个 run 正常结束 → 通知上层清掉续跑快照
        callbacks.onToolProgress?.({
          iteration,
          done: [],
          pending: [],
          finished: true,
        });
        return finalResponse.content || '';
      }

      // 情况 2：LLM 调用工具
      // 必须把 assistant message 完整存下来（含 tool_calls），否则下一轮报 400
      messages.push({
        role: 'assistant',
        content: finalResponse.content || '',
        tool_calls: finalResponse.toolCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      // 逐个执行工具
      //
      // ⭐ 2026-10-22 关键修复：中断时必须补齐【剩余全部】tool_call
      //
      //   原来的写法只给"当前这一个" tc 补了中断说明就 return。
      //   但 LLM 一次可能返回多个 tool_calls（如 read_file + grep + list_dir），
      //   中断发生在第 2 个时，第 3 个永远不会有响应 —— 成了孤儿。
      //
      //   后果（生产级故障，不是理论问题）：
      //     1. 这份残缺结构被 SessionStore 原样写进 .jsonl
      //     2. 用户重开 VS Code，load() 读回来发给 provider
      //     3. provider 返回 400：
      //        "An assistant message with 'tool_calls' must be followed by
      //         tool messages responding to each tool_call_id"
      //     4. 对话永久卡死，只能删文件重来
      //
      //   触发条件：AI 一次叫多个工具时点"停止"。这是每天都在发生的高频操作。
      //
      //   为什么不能简单地"不要那条 tool_call 了"：
      //     如果那个工具可能已经产生了外部副作用（文件被删了、git push 发出去了），
      //     悄悄删掉记录会让模型以为没发生过，从而重做一遍 —— 从"做了一次"
      //     变成"做了两次"。所以必须显式告诉模型"这一步没执行完"。
      //
      //   配套的第二道保险在 util/historyRepair.ts（读会话时自愈），
      //   它负责救回磁盘上【已经存在的】坏记录。
      const completed: Array<{ id: string; name: string }> = [];

      // ═══════════════════════════════════════════════════════════════
      // ⭐⭐⭐ 2026-10-24 改造：并行工具调用
      // ═══════════════════════════════════════════════════════════════
      //
      //   改造前：所有 tool_calls 严格串行，一个一个 await。
      //   改造后：只读工具一批并行执行，写/执行类工具仍串行。
      //
      //   类比：
      //     你让助理去复印三份文件、并把三份分别装订。
      //     改造前：复印 1 → 等 → 复印 2 → 等 → 复印 3 → 等
      //     改造后：复印 1/2/3 同时开始 → 等 → 三份一起装订
      //
      //     前提是这三件事互不干扰 —— 你不能一边复印一边把原件撕了。
      //
      //   借鉴来源：
      //     · nanobot/agent/tools/execution.py:294-318 _partition_tool_batches
      //       （按 concurrency_safe 语义分批）
      //     · nanobot/agent/tools/base.py:216-229
      //       （read_only / concurrency_safe / exclusive 三个语义字段）
      //     · goose/agents/state_machine/ops_toolcalling.rs:1010-1044
      //       （select_all 并发轮询）
      //
      //   ⚠️⚠️⚠️ 三个必须做对的点，错了就是 400：
      //
      //   1) 【结果顺序必须和 tool_calls 顺序一致】
      //      OpenAI 协议要求 assistant 声明了 N 个 tool_call，
      //      就必须紧跟 N 条 tool 消息，且 tool_call_id 一一对应。
      //      Promise.all 的结果顺序是【按传入顺序】返回的，
      //      所以只要按原顺序传进去、按原顺序取出来就对了。
      //      但绝不能"谁先跑完谁先 push" —— 那会乱序。
      //
      //   2) 【写工具绝对不能并行】
      //      两个 apply_patch 改同一个文件 → 后写的覆盖先写的，
      //      而且 checkpoint 快照会乱。
      //      另外写工具要弹审批窗 —— 两个弹窗同时弹，用户懵了。
      //
      //   3) 【中断处理要更细】
      //      并行执行时用户点"停止"：
      //        · 已经在跑的 → 靠 signal 传给工具，让工具自己 abort
      //          （run_shell 靠这个杀子进程）
      //        · 还没开始的 → 补"[用户中断了本次任务，该工具未执行]"
      //
      //   ⚠️ 本项目已有的 concurrentSafe 字段（tools/meta.ts:48-52）
      //      之前定义了但从没被用过 —— 这次终于把它接上了。

      const batches = partitionToolCalls(finalResponse.toolCalls, this.registry);

      for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const batchStartIndex = batches
          .slice(0, bi)
          .reduce((n, b) => n + b.calls.length, 0);

        // ── 中断检查（批次级别）──
        if (signal?.aborted) {
          // 先报告进度：让上层有机会把"哪些做完了"存成快照。
          // ⚠️ 必须在往 messages 里补中断说明【之前】报告，
          //    否则上层存的快照会包含这些还没 push 的"补位消息"，
          //    恢复时就分不清它们是真的执行过还是补上去的了。
          callbacks.onToolProgress?.({
            iteration,
            done: [...completed],
            pending: finalResponse.toolCalls
              .slice(batchStartIndex)
              .map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })),
            finished: false,
          });

          // 补齐【剩余全部】tool_call（不只是当前批次）
          for (let j = batchStartIndex; j < finalResponse.toolCalls.length; j++) {
            const pending = finalResponse.toolCalls[j];
            messages.push({
              role: 'tool',
              tool_call_id: pending.id,
              content: '[用户中断了本次任务，该工具未执行]',
            });
          }
          return this._abortedResult(messages);
        }

        // ── 解析参数（所有批次共用）──
        const parsed = batch.calls.map((tc) => {
          let args: any = {};
          try {
            args = JSON.parse(tc.arguments || '{}');
          } catch {
            args = {};
          }
          return args;
        });

        // ── 执行 ──
        let results: ToolResult[];
        if (batch.parallel) {
          // ⭐ 并行执行
          //   Promise.all 保证结果顺序 === 传入顺序（V8 规范保证），
          //   所以后面按顺序 push 就对了。
          results = await Promise.all(
            batch.calls.map((tc, idx) => {
              callbacks.onToolCall(tc.name, parsed[idx]);
              return this.registry.execute(tc.name, parsed[idx], signal);
            }),
          );
        } else {
          // 串行执行（写/执行类工具）
          results = [];
          for (let idx = 0; idx < batch.calls.length; idx++) {
            const tc = batch.calls[idx];
            // 串行时每个工具执行前都要检查中断
            if (signal?.aborted) {
              callbacks.onToolProgress?.({
                iteration,
                done: [...completed],
                pending: finalResponse.toolCalls
                  .slice(batchStartIndex + idx)
                  .map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })),
                finished: false,
              });
              for (let j = batchStartIndex + idx; j < finalResponse.toolCalls.length; j++) {
                const pending = finalResponse.toolCalls[j];
                messages.push({
                  role: 'tool',
                  tool_call_id: pending.id,
                  content: '[用户中断了本次任务，该工具未执行]',
                });
              }
              return this._abortedResult(messages);
            }
            callbacks.onToolCall(tc.name, parsed[idx]);
            results.push(await this.registry.execute(tc.name, parsed[idx], signal));
          }
        }

        // ── 回填结果（严格按原顺序）──
        for (let idx = 0; idx < batch.calls.length; idx++) {
          const tc = batch.calls[idx];
          const result = results[idx];

          // ⭐ 大输出外置（2026-10-22）
          //
          //   ReAct 循环每一步都要重发全部上下文，所以"塞进上下文的东西"
          //   实际上会被重复发送十几次、几十次。评测数据显示输入 token
          //   是输出的 20 倍，根源就在这。
          //
          //   这里把超大输出落盘，回灌给 LLM 的是「头尾预览 + 文件路径」，
          //   LLM 需要细节时用 read_file 带 offset/limit 精准取。
          //
          //   为什么放在这里而不是各个工具内部：
          //     · 单一入口，9 个工具都不用改（跟 factory.ts 的思路一致：
          //       收拢到一个地方，避免"加个工具就忘了做这件事"）
          //     · 阈值策略只在这里维护一份
          //     · isError 的原始结果已经拿到了，外置不影响错误语义
          const { content: finalContent, stored } = maybeExternalize(tc.name, result.content, parsed[idx]);
          if (stored) {
            info(
              `[外置] ${tc.name} 输出 ${stored.originalChars} 字符 / ${stored.lines} 行 → ${stored.relPath}`,
            );
            // 告诉用户"它读了个大文件"，否则用户会以为 agent 卡住了
            callbacks.onText(
              `\n📄 ${tc.name} 输出过大（${stored.originalChars} 字符），` +
                `已存到 ${stored.relPath}，对话里只保留头尾预览。\n\n`,
            );
          }

          callbacks.onToolResult(tc.name, { content: finalContent, isError: result.isError });

          // ⭐ 写/执行类工具跑完后，让「外部查询计数」全部失效
          //
          //   原因：grep 的结果取决于整个工作区的状态。
          //   agent 改了文件之后再 grep 同样的 pattern，结果是不同的 ——
          //   这时再拦截它就是错的，会逼 agent 用过期的搜索结果做决策。
          //
          //   举例：agent grep "TODO" → 改了文件 → 又 grep "TODO"
          //        （这次多了一处 TODO）→ 这次必须放行。
          //
          //   借鉴 nanobot/agent/tools/file_state.py:76-78（写入即失效回执）
          if (!batch.parallel) {
            getGuard().invalidateQueryCounts();
          }

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: finalContent,
          });

          // ⭐ 每完成一个工具就立刻上报进度
          //   必须在 messages.push 之后 —— 这样上层拿到的 "done" 一定是
          //   真的已经落进 messages 了，恢复时才不会误判成"未执行"。
          completed.push({ id: tc.id, name: tc.name });
          callbacks.onToolProgress?.({
            iteration,
            done: [...completed],
            pending: finalResponse.toolCalls
              .slice(batchStartIndex + idx + 1)
              .map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })),
            // ⚠️ 这里永远是 false：还有下一轮循环在跑。
            //   finished 的语义是"【整个 run】结束"，不是"这批工具跑完"——
            //   否则上层会在第一轮就跑完时就清掉续跑快照，
            //   后面几轮中途崩溃就恢复不了了。
            finished: false,
          });
        }
      }
    }

    // ⭐ 触顶了：不是甩一句"超限"就走，而是让 LLM 无工具总结当前进展。
    //   借鉴 nanobot runner.py:1168 —— 用户最需要的是"它到底干了啥"。
    const summary = await this._finalizeWithoutTools(messages, signal, callbacks, this.maxIterations);

    // 触顶收尾也算 run 正常结束（此时没有未完成的工具）
    callbacks.onToolProgress?.({
      iteration: this.maxIterations - 1,
      done: [],
      pending: [],
      finished: true,
    });

    return summary;
  }

  /** 用户中断：保留已完成的对话，追加一条说明，返回 */
  private _abortedResult(messages: any[]): string {
    return '[已中断] 任务被用户手动停止。上面已完成的部分保留在对话里，可以直接接着说下一步。';
  }

  /**
   * 触顶收尾：发一次【不带工具】的请求，让 LLM 总结进度
   *
   * 为什么重要：
   *   用户看到的如果只是"[已达到最大迭代次数 20]"，他完全不知道 AI 干了什么、
   *   改了什么、下一步该干嘛 —— 这是最让人抓瞎的结局。
   *   加一次无工具总结，至少能拿到一份可读的进度报告。
   */
  private async _finalizeWithoutTools(
    messages: any[],
    signal: AbortSignal | undefined,
    callbacks: AgentCallbacks,
    maxIterations: number,
  ): Promise<string> {
    const notice =
      `\n\n[系统提示：你已达到本轮最大工具调用次数（${maxIterations}）。` +
      `请不要再调用任何工具，直接用中文总结：\n` +
      `1. 已经完成了什么（列出改过的文件）\n` +
      `2. 遇到了什么问题\n` +
      `3. 建议用户下一步做什么]`;

    // 末尾补一条 user 消息触发总结（不带工具 → LLM 只能输出文本）
    messages.push({ role: 'user', content: notice });

    let summary = '';
    try {
      // ⭐ 双可见性：触顶收尾也要用过滤后的消息
      //   （被压缩掉的历史不该在收尾总结里重新冒出来）
      for await (const chunk of this.provider.stream(filterForModel(messages), [], signal)) {
        if (chunk.content) {
          summary += chunk.content;
          callbacks.onText(chunk.content);
        }
        if (chunk.isFinal) break;
      }
    } catch (e: any) {
      // 总结失败也要给用户交代，不能静默
      return summary || `[已达到最大迭代次数 ${maxIterations}，且无法生成总结：${e?.message || e}]`;
    }

    return summary || `[已达到最大迭代次数 ${maxIterations}]`;
  }

  /**
   * autocompact：messages 太长时自动压缩
   *
   * 借鉴自 nanobot/autocompact.py 的核心思想：
   *   - 监测累计字符数（≈ token 数）
   *   - 超阈值时调 LLM 把早期历史总结
   *   - 保留 system prompt + 最近 K 条消息不丢
   *
   * 简化版 vs nanobot：
   *   - 不做 idle TTL（我们不需要多 session 概念）
   *   - 不做持久化 summary（单次 run 内存里）
   *   - 同步触发（不排队后台）
   *
   * 失败保护：总结失败时静默跳过，不影响主循环
   */
  private async maybeCompact(
    messages: any[],
    signal: AbortSignal | undefined,
    callbacks: AgentCallbacks,
  ): Promise<void> {
    // ⭐ 2026-10-21 改用 token 计数
    //   原来是数字符（COMPACT_THRESHOLD_CHARS = 80000），
    //   但 token ≠ 字符：同样 8 万字符，全英文约 2 万 token，
    //   全中文约 6 万 token，误差 3 倍。估少了白丢历史，
    //   估多了会被 API 直接 400 拒绝、整轮对话崩掉。
    //
    //   现在按【上下文窗口的使用比例】触发（借鉴 goose 的 0.7），
    //   并且中英文分开估算（见 util/tokens.ts）。
    //
    // ⭐ 2026-10-24 双可见性改造：必须用【过滤后】的消息算。
    //   否则会把「模型看不见但用户还看得到」的历史也算进去 ——
    //   那部分根本不占模型的上下文窗口。
    //   算虚高会导致【过早触发压缩】，白白丢历史。
    const visible = filterForModel(messages);
    const totalTokens = estimateMessagesTokens(visible, this.registry.schemas);
    const threshold = Math.floor(this.contextWindow * COMPACT_THRESHOLD_RATIO);

    // 每轮都把用量报给 UI，让用户看得见"还剩多少"
    callbacks.onUsage?.(totalTokens, this.contextWindow);

    if (totalTokens < threshold) return;

    // 切分：system + [要总结的] + [保留最近的]
    const systemIdx = messages[0]?.role === 'system' ? 0 : -1;
    const startIdx = systemIdx >= 0 ? 1 : 0;
    const endIdx = messages.length - KEEP_RECENT_MESSAGES;

    if (endIdx <= startIdx + 1) return;  // 没东西可压缩

    // ⚠️ 这里不再提前切出 toSummarize —— 分组时必须按
    //   「assistant + 它后面所有 tool 消息」为一组遍历，
    //   预先 slice 反而会把一组拆开，那正是下面注释里说的那个 bug。
    const recent = messages.slice(endIdx);

    // ⭐ 关键修复：tool 消息【永远不能被压缩掉】
    //   tool 消息记录的是"我实际改了什么、命令返回了什么"。
    //   一旦压缩掉，LLM 就失去了对自己行为的记忆，会重复改同一个文件、
    //   或者以为命令跑过了而跳过 —— 这正是原来那个 bug 的根因。
    //
    // ⭐⭐ 2026-10-22 二次修复：保护范围必须【连带 assistant 消息】
    //
    //   原来的分法是：
    //     role === 'tool'  → protectedMessages（保住）
    //     其他（含 assistant）→ summarizable（压成摘要）
    //
    //   这是错的。带 tool_calls 的 assistant 消息一旦被压进摘要，
    //   它对应的 tool 消息就成了【孤立 tool】—— 找不到任何 tool_call 声明过它。
    //   压缩后的结构长这样：
    //     [system] [摘要] [tool结果 tool结果 tool结果 ...] [最近的消息]
    //                        ↑ 全是孤儿，provider 直接 400
    //
    //   而且这个 bug 比"用户点停止"严重得多：
    //     · 中断 bug 要用户主动点停止才触发
    //     · autocompact 在【任何长对话里必然触发】（阈值 = 上下文窗口 70%）
    //   也就是说，用户聊得越久、越信任这个工具，就越容易撞上。
    //
    //   正确做法：把 assistant + 它后面所有 tool 消息当成【一个整体】保护，
    //   绝不拆散。协议要求它们必须紧邻，拆了就非法。
    const protectedMessages: any[] = [];
    const summarizable: any[] = [];

    let cursor = startIdx;
    while (cursor < endIdx) {
      const m = messages[cursor];

      const isToolCallingAssistant =
        m?.role === 'assistant' &&
        Array.isArray(m.tool_calls) &&
        m.tool_calls.length > 0;

      if (isToolCallingAssistant) {
        // 整体保护：assistant 本体 + 紧随其后的全部 tool 消息
        protectedMessages.push(m);
        let k = cursor + 1;
        while (k < endIdx && messages[k]?.role === 'tool') {
          protectedMessages.push(messages[k]);
          k++;
        }
        cursor = k;
        continue;
      }

      if (m?.role === 'tool') {
        // 没有对应 assistant 的残留 tool（理论上不该有，有 historyRepair 兜底）
        // 照样保护：宁可不压也不能丢
        protectedMessages.push(m);
        cursor++;
        continue;
      }

      // 纯对话消息（user / 无工具调用的 assistant / system 片段）
      summarizable.push(m);
      cursor++;
    }

    if (summarizable.length === 0) {
      // 全是 tool 消息，宁可不压也不能丢
      return;
    }

    // ⭐ 2026-10-24 双可见性：只总结【当前模型还看得见】的消息
    //
    //   为什么必须过滤：
    //     上一次压缩时，旧的原始对话已经被打上 agentVisible=false，
    //     但它们【仍然留在 messages 里】（这是双可见性的核心 —— 用户还能回看）。
    //
    //     如果不把它们排除掉：
    //       · 摘要 prompt 会把同一批历史再塞一遍（重复劳动）
    //       · 更糟的是：上一轮的【摘要消息本身】也会被再次总结，
    //         导致摘要套摘要、越滚越长、越滚越失真
    //
    //   这是双可见性带来的新情况 —— 原来（原地重排）不存在这个问题，
    //   因为被压掉的消息已经不在 messages 里了。
    const visibleSummarizable = summarizable.filter((m) => m?.agentVisible !== false);

    if (visibleSummarizable.length === 0) {
      // 全是已经压过的历史 —— 没什么新的可总结
      return;
    }

    // 构造总结 prompt
    const transcriptText = visibleSummarizable
      .map((m) => {
        const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        const tools = m.tool_calls ? ` [调用工具: ${m.tool_calls.map((tc: any) => tc.function?.name).join(', ')}]` : '';
        return `[${m.role}]${tools}: ${c.slice(0, 800)}`;
      })
      .join('\n\n');

    const summaryPrompt = `请把以下 agent 对话历史总结成简洁的要点，保留：
- 用户的核心需求和偏好
- 已修改的文件路径 + 修改内容
- 关键决策和发现
- 测试结果（如有）

少于 1500 字，用 Markdown 列表形式。

对话历史：
${transcriptText}`;

    let summary = '';
    try {
      for await (const chunk of this.provider.stream(
        [{ role: 'user', content: summaryPrompt }],
        [],  // 总结时不传 tools，避免 LLM 又想调工具
        signal,
      )) {
        if (chunk.content) summary += chunk.content;
        if (chunk.isFinal) break;
      }
    } catch {
      // 总结失败静默跳过
      return;
    }

    if (!summary.trim()) return;

    // ═══════════════════════════════════════════════════════════════
    // ⭐⭐⭐ 2026-10-24 重大改造：双可见性（Dual Visibility）
    // ═══════════════════════════════════════════════════════════════
    //
    //   借鉴来源：goose 的 context_mgmt/mod.rs:89-226
    //     · MessageMetadata { user_visible, agent_visible }
    //       （goose-provider-types/src/conversation/message.rs:828-834）
    //     · 压缩时：原消息 → agent_invisible（用户仍看得到）
    //              摘要   → agent_only（用户不用看技术摘要）
    //       （context_mgmt/mod.rs:159-191）
    //
    //   改造前 vs 改造后：
    //
    //     改造前（原地重排）：
    //       [system] [摘要] [protected tool 消息] [最近 12 条]
    //       ↑ 被压掉的原始对话【彻底消失】，用户在 UI 里再也看不到
    //
    //     改造后（打标记）：
    //       [system] [摘要 agentVisible=true]
    //       [被压掉的原始对话 agentVisible=false]   ← 还在，只是模型看不见
    //       [protected tool 消息]
    //       [最近 12 条]
    //       ↑ 用户仍能滚动查看完整历史，模型只看到摘要
    //
    //   类比：
    //     改造前 = 把笔记本前半本【撕掉】给模型看
    //     改造后 = 给模型一份【目录 + 摘要】，笔记本完整躺在档案柜里，
    //              用户想翻随时能翻
    //
    //   三个直接收益：
    //     1. 产品价值：长对话后用户能回看完整历史
    //     2. 工程价值：压缩变成【可逆】的 —— 调试时能看出压掉了什么
    //     3. 成本价值：模型看到的更少 → 每轮重发的上下文更小 → token 更低
    //
    //   ⚠️ 关键约束（必须同时满足，否则会出 400）：
    //     agentVisible=false 的消息【只对模型隐藏】，不改变它在 messages 里的位置。
    //     结构合法性（assistant 的 tool_calls 必须紧邻对应的 tool 消息）
    //     完全不受影响 —— 因为我们没有移动任何消息。
    //
    //   ⚠️⚠️ 最重要的坑：被隐藏的消息【不能发给 provider】
    //     如果只是打标记但仍然全部发给 provider，token 一分钱都没省，
    //     而且 provider 会看到一堆互相矛盾的历史。
    //     所以必须在【每次请求前】过滤 —— 见 filterForModel()。
    //
    //   ⚠️⚠️ 第二个坑：tool 消息绝对不能被隐藏
    //     tool 消息记录的是"我实际改了什么" —— 隐藏它等于让模型失忆，
    //     会重复改同一个文件。下面的 protectedMessages 逻辑保持不变。

    // 标记：被压缩掉的原始消息 → 模型看不见，用户仍可见
    for (const m of summarizable) {
      m.agentVisible = false;
    }

    // 摘要消息：只给模型看（用户不需要看技术摘要）
    const summaryMessage = {
      role: 'system',
      content: `[Earlier conversation summary — autocompact triggered at ${messages.length} messages]\n\n${summary.trim()}`,
      agentVisible: true,
      userVisible: false,
    };

    // ⭐ 组装新的 messages：顺序是
    //   [原 system] [摘要] [被隐藏的原始对话] [受保护的 tool 消息] [最近的消息]
    //
    //   注意【被隐藏的原始对话】要放回来 —— 这是双可见性的核心。
    //   放回原位，保证 tool_call / tool 消息的相对顺序不变。
    const newMessages: any[] = [];
    if (systemIdx >= 0) newMessages.push(messages[0]);  // 保留原 system
    newMessages.push(summaryMessage);
    newMessages.push(...summarizable);           // ⭐ 打上了 agentVisible=false
    // ⭐ 被保护的工具消息按原顺序放回（它们比摘要更权威 ——
    //   摘要可能漏掉细节，但工具结果是客观事实）
    newMessages.push(...protectedMessages);
    newMessages.push(...recent);

    // ⭐ 压完后补一条"继续"指令
    //   没有这条的话，LLM 拿到一段摘要后常常会"忘了自己正在干嘛"，
    //   要么停下来问用户，要么从头再来一遍。
    //   借鉴 nanobot 的 context_governance.py:574 —— 压缩后明确告诉它继续。
    newMessages.push({
      role: 'user',
      content:
        `[系统提示：上面的对话历史因为过长被压缩成了一段摘要，工具调用记录仍完整保留。` +
        `请基于摘要和工具记录继续完成你之前正在做的任务，不要重新开始，也不要询问用户是否要继续。]`,
    });

    messages.length = 0;
    messages.push(...newMessages);

    // ⭐ 压缩后必须重算「当前可见的 tool_call_id 集合」
    //   重复检测的第四重校验（"原结果是否还在上下文里"）依赖这个集合。
    //   虽然当前逻辑下 protectedMessages 不隐藏，但 loop 不该假设下游不变。
    refreshVisibleCallIds(messages);

    callbacks.onCompact?.(
      `🔄 autocompact：${summarizable.length} 条对话 → 1 段总结` +
      `（保住 ${protectedMessages.length} 条工具记录 + ${recent.length} 条最近消息；` +
      `被压缩的历史仍可回看）`,
    );
  }
}
