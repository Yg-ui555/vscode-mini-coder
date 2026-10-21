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
 *   ✅ 真正的超阈值压缩在 nanobot/context_governance.py，本文件的
 *      COMPACT_THRESHOLD_CHARS 思路来自那里的 compact_messages 机制，
 *      但当前仍是简化版，与 nanobot 的差距在：
 *        1. nanobot 按真 token + 模型窗口动态算预算；我们按固定 8 万字符估算
 *        2. nanobot 用「水位线」——原文全留磁盘，只是不再重发给 LLM；
 *           我们是原地重排 messages
 *        3. nanobot summary 落盘；我们是内存里，重启就丢
 *        4. 我们固定保留最近 6 条，长工具链里可能把上一步的工具结果挤出去，
 *           导致 LLM 重复改同一个文件
 *      改进方案见文件末尾 TODO 注释。
 * ─────────────────────────────────────────────────────────────
 */

import { OpenAIProvider } from './provider';
import { ToolRegistry, ToolResult } from './tools/registry';

export interface AgentCallbacks {
  onText: (chunk: string) => void;
  onToolCall: (name: string, args: any) => void;
  onToolResult: (name: string, result: ToolResult) => void;
  onCompact?: (summary: string) => void;  // ← 新增：压缩事件回调
}

/** autocompact 阈值（字符数）—— ≈ 20k tokens，中文按 1 char ≈ 1 token 估算 */
const COMPACT_THRESHOLD_CHARS = 80_000;
/** 保留最近 N 条消息不被压缩 */
const KEEP_RECENT_MESSAGES = 6;
/** 压缩总结的最大字数 */
const SUMMARY_MAX_CHARS = 1500;

export class AgentLoop {
  constructor(
    private provider: OpenAIProvider,
    private registry: ToolRegistry,
    private maxIterations = 30,
  ) {}

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
    const totalChars = messages.reduce((sum, m) => {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
      return sum + c.length;
    }, 0);

    if (totalChars < COMPACT_THRESHOLD_CHARS) return;

    // 切分：system + [要总结的] + [保留最近的]
    const systemIdx = messages[0]?.role === 'system' ? 0 : -1;
    const startIdx = systemIdx >= 0 ? 1 : 0;
    const endIdx = messages.length - KEEP_RECENT_MESSAGES;

    if (endIdx <= startIdx + 1) return;  // 没东西可压缩

    const toSummarize = messages.slice(startIdx, endIdx);
    const recent = messages.slice(endIdx);

    // 构造总结 prompt
    const transcriptText = toSummarize
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

少于 ${SUMMARY_MAX_CHARS} 字，用 Markdown 列表形式。

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
    newMessages.push(...recent);

    messages.length = 0;
    messages.push(...newMessages);

    callbacks.onCompact?.(
      `🔄 autocompact：${toSummarize.length} 条历史 → 1 段总结（${summary.length} 字）`,
    );

    // ─────────────────────────────────────────────────────────
    // TODO(改进方案)：当前实现与 nanobot 的三个已知差距
    //
    // 1) 【保留策略会导致重复改文件】——最该先修的一条
    //    现在固定保留最近 KEEP_RECENT_MESSAGES=6 条。长工具链跑起来后，
    //    最近 6 条很可能正好把「上一步 apply_patch 的结果」挤出去，
    //    LLM 看不见自己刚改了什么 → 重复改同一个文件。
    //    nanobot 的解法（水位线）：原文永远留在数组里，只是打一个
    //    "archiveIndex"，重发给 LLM 时只发 [0..archiveIndex] 的 summary
    //    + (archiveIndex..end] 的原文。内存占用不变，但 LLM 看到的是
    //    完整摘要，不会因为"砍太狠"而失忆。
    //
    //    最小改法：KEEP_RECENT_MESSAGES 提到 12~16，
    //    并且压缩时【优先保住所有 tool 消息】（哪怕更早的），
    //    只压缩纯 user/assistant 的对话轮次。
    //
    // 2) 【summary 落盘】
    //    现在 summary 只活在内存的 messages 里，插件重开就没了。
    //    nanobot 存进 session.metadata，重启能接着用。
    //    我们可以存到 context.globalState（VS Code 提供的持久化 KV）。
    //
    // 3) 【压完后补"继续"指令】
    //    如果这轮压缩后没有新的用户输入（常见于自动跑测试失败后接着修），
    //    LLM 看到一段 summary 会"忘了自己正在干嘛"。
    //    nanobot 的做法（context_governance.py:574）：补一条
    //    continuation 消息，明确告诉它"继续完成之前在做的任务"。
    //
    // 优先级：1 > 3 > 2。第 1 条是真实会导致改错代码的，第 3 条几行代码。
    // ─────────────────────────────────────────────────────────
  }
}
