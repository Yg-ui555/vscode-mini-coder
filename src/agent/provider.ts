/**
 * OpenAI 兼容 LLM Provider
 *
 * 自己写 fetch 而不用 openai SDK 的原因：
 * - SDK 重（带 SDK 概念和额外抽象层）
 * - 自己可控，方便面试讲底层原理
 * - 流式（streaming）直接 fetch + ReadableStream
 *
 * 支持：DeepSeek / MiniMax / OpenAI / Ollama（任何 OpenAI 兼容 API）
 *
 * 流式原理（SSE，Server-Sent Events，服务器推送事件）：
 * - HTTP 响应是 chunked transfer encoding（不知道总长度，服务器边生成边发）
 * - 每段格式：`data: {...json...}\n\n`
 * - fetch + getReader() 异步逐行读，不阻塞事件循环
 * - LLM 每生成一个 token 就推一段，前端能看到打字机效果
 */

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCallRequest[];
  finishReason: string;
}

export interface StreamChunk {
  content?: string;
  isFinal?: boolean;
  finalResponse?: LLMResponse;
}

export class OpenAIProvider {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
  ) {}

  /**
   * 流式调用 LLM
   * @returns AsyncGenerator 持续产出文本片段，最后产出 finalResponse
   */
  async *stream(
    messages: Array<{ role: string; content?: string; tool_calls?: any[]; tool_call_id?: string }>,
    tools: Array<{ type: string; function: any }>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const body = {
      model: this.model,
      messages,
      stream: true,
      ...(tools.length > 0 ? { tools } : {}),
    };

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`API 错误 ${resp.status}: ${errText.slice(0, 200)}`);
    }
    if (!resp.body) throw new Error('响应无 body');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let contentBuf = '';
    const toolCallsMap = new Map<number, ToolCallRequest>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              contentBuf += delta.content;
              yield { content: delta.content };
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index || 0;
                if (!toolCallsMap.has(idx)) {
                  toolCallsMap.set(idx, {
                    id: tc.id || `call_${Date.now()}_${idx}`,
                    name: '',
                    arguments: '',
                  });
                }
                const entry = toolCallsMap.get(idx)!;
                if (tc.id) entry.id = tc.id;
                if (tc.function?.name) entry.name = tc.function.name;
                if (tc.function?.arguments) entry.arguments += tc.function.arguments;
              }
            }
          } catch {
            // 单行 parse 失败不致命
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      isFinal: true,
      finalResponse: {
        content: contentBuf || null,
        toolCalls: Array.from(toolCallsMap.values()),
        finishReason: toolCallsMap.size > 0 ? 'tool_calls' : 'stop',
      },
    };
  }
}