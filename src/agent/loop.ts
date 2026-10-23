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

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      // ⭐ 每轮前检查用户是否点了"停止"
      if (signal?.aborted) return this._abortedResult(messages);

      // ⭐ 每轮前检查是否需要 autocompact
      await this.maybeCompact(messages, signal, callbacks);

      let finalResponse: any = null;

      for await (const chunk of this.provider.stream(messages, this.registry.schemas, signal)) {
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

      for (let i = 0; i < finalResponse.toolCalls.length; i++) {
        const tc = finalResponse.toolCalls[i];

        // 每个工具执行前再检查一次 —— 用户可能在工具跑一半时点的停止
        if (signal?.aborted) {
          // 先报告进度：让上层有机会把"哪些做完了"存成快照。
          // ⚠️ 必须在往 messages 里补中断说明【之前】报告，
          //    否则上层存的快照会包含这些还没 push 的"补位消息"，
          //    恢复时就分不清它们是真的执行过还是补上去的了。
          callbacks.onToolProgress?.({
            iteration,
            done: [...completed],
            pending: finalResponse.toolCalls
              .slice(i)
              .map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })),
            finished: false,
          });

          for (let j = i; j < finalResponse.toolCalls.length; j++) {
            const pending = finalResponse.toolCalls[j];
            messages.push({
              role: 'tool',
              tool_call_id: pending.id,
              content: '[用户中断了本次任务，该工具未执行]',
            });
          }
          return this._abortedResult(messages);
        }

        let args: any = {};
        try {
          args = JSON.parse(tc.arguments || '{}');
        } catch {
          args = {};
        }

        callbacks.onToolCall(tc.name, args);
        const result = await this.registry.execute(tc.name, args, signal);

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
        const { content: finalContent, stored } = maybeExternalize(tc.name, result.content, args);
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
            .slice(i + 1)
            .map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })),
          // ⚠️ 这里永远是 false：还有下一轮循环在跑。
          //   finished 的语义是"【整个 run】结束"，不是"这批工具跑完"——
          //   否则上层会在第一轮就跑完时就清掉续跑快照，
          //   后面几轮中途崩溃就恢复不了了。
          finished: false,
        });
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
      for await (const chunk of this.provider.stream(messages, [], signal)) {
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
    const totalTokens = estimateMessagesTokens(messages, this.registry.schemas);
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

    // 构造总结 prompt
    const transcriptText = summarizable
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

    // 替换 messages
    const newMessages: any[] = [];
    if (systemIdx >= 0) newMessages.push(messages[0]);  // 保留原 system
    newMessages.push({
      role: 'system',
      content: `[Earlier conversation summary — autocompact triggered at ${messages.length} messages]\n\n${summary.trim()}`,
    });
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

    callbacks.onCompact?.(
      `🔄 autocompact：${summarizable.length} 条对话 → 1 段总结` +
      `（保住 ${protectedMessages.length} 条工具记录 + ${recent.length} 条最近消息）`,
    );
  }
}
