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
 *   3) 【历史自愈】—— nanobot 会清理畸形 tool_call / 孤立 tool 结果，
 *      本项目还没有，见 util/historyRepair.ts（待做）。
 * ─────────────────────────────────────────────────────────────
 */

import { OpenAIProvider } from './provider';
import { ToolRegistry, ToolResult } from './tools/registry';
import { estimateMessagesTokens, contextWindowFor, DEFAULT_CONTEXT_WINDOW } from '../util/tokens';

export interface AgentCallbacks {
  onText: (chunk: string) => void;
  onToolCall: (name: string, args: any) => void;
  onToolResult: (name: string, result: ToolResult) => void;
  onCompact?: (summary: string) => void;  // ← 新增：压缩事件回调
  /** 上下文用量变化（用于 UI 显示"已用 12k / 64k"） */
  onUsage?: (current: number, window: number) => void;
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
    private maxIterations = 30,
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
    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      // ⭐ 每轮前检查用户是否点了"停止"
      if (signal?.aborted) return this._abortedResult(messages);

      // ⭐ 每轮前检查是否需要 autocompact
      await this.maybeCompact(messages, signal, callbacks);

      let finalResponse: any = null;

      for await (const chunk of this.provider.stream(messages, this.registry.schemas, signal)) {
        if (chunk.isFinal && chunk.finalResponse) {
          finalResponse = chunk.finalResponse;
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
      for (const tc of finalResponse.toolCalls) {
        // ⭐ 每个工具执行前再检查一次 —— 用户可能在工具跑一半时点的停止
        if (signal?.aborted) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: '[用户中断了本次任务，该工具未执行]',
          });
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
        callbacks.onToolResult(tc.name, result);

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result.content,
        });
      }
    }

    // ⭐ 触顶了：不是甩一句"超限"就走，而是让 LLM 无工具总结当前进展。
    //   借鉴 nanobot runner.py:1168 —— 用户最需要的是"它到底干了啥"。
    return await this._finalizeWithoutTools(messages, signal, callbacks, this.maxIterations);
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

    const toSummarize = messages.slice(startIdx, endIdx);
    const recent = messages.slice(endIdx);

    // ⭐ 关键修复：tool 消息【永远不能被压缩掉】
    //   tool 消息记录的是"我实际改了什么、命令返回了什么"。
    //   一旦压缩掉，LLM 就失去了对自己行为的记忆，会重复改同一个文件、
    //   或者以为命令跑过了而跳过 —— 这正是原来那个 bug 的根因。
    const protectedMessages: any[] = [];
    const summarizable: any[] = [];
    for (const m of toSummarize) {
      if (m.role === 'tool') protectedMessages.push(m);
      else summarizable.push(m);
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
