/**
 * Agent 主循环 - ReAct 范式
 *
 * ReAct = Reasoning + Acting（思考-行动循环）
 * 算法：
 *   1. 把 system prompt + 历史 + 用户最新输入丢给 LLM
 *   2. LLM 要么返回文本（任务完成），要么返回 tool_calls（要干活）
 *   3. 如果是 tool_calls，挨个执行，把结果塞回 messages
 *   4. 回到第 1 步继续问 LLM
 *   5. 直到 LLM 不再返回 tool_calls，说明任务完成
 *
 * 关键设计：
 * - maxIterations 上限（防 LLM 死循环，30 轮够）
 * - AbortSignal 中断（VS Code 关闭时停掉，释放连接）
 * - 流式回调（用户实时看到 LLM 在想什么）
 * - ⭐ autocompact（自动压缩上下文）—— 借鉴自 nanobot/autocompact.py
 *
 * autocompact 借鉴来源：D:/AI agent/nanobot-main/nanobot/agent/autocompact.py
 *   原理：当 messages 累计字符数 > 80k（≈ 20k tokens），调 LLM 把早期历史
 *         总结成一段，腾出 token 空间。
 *   触发：每轮 provider.stream 调用前检查
 *   保留：system prompt + 最近 6 条消息（保证短期上下文不丢）
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
        let args: any = {};
        try {
          args = JSON.parse(tc.arguments || '{}');
        } catch {
          args = {};
        }

        callbacks.onToolCall(tc.name, args);
        const result = await this.registry.execute(tc.name, args);
        callbacks.onToolResult(tc.name, result);

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result.content,
        });
      }
    }

    return `[已达到最大迭代次数 ${this.maxIterations}]`;
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
  }
}
