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
 *
 * 改进：
 * - fetch 包到 retry 里（网络抖了自动重试）
 * - 错误分类（APIError / NetworkError，前端能针对性提示）
 */

import { retry, defaultShouldRetry } from '../retry';
import { APIError, NetworkError, AuthError, RateLimitError, CreditsExhaustedError, EndpointNotFoundError } from '../errors';
import { info, warn } from '../logger';

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

    // 包到 retry 里：网络抖了自动重试（最多 3 次，1s/2s/4s 指数退避）
    // 4xx 错误（用户配错）不重试，5xx/网络错才重试
    const resp = await retry(
      async () => {
        try {
          const r = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal,
          });
          if (!r.ok) {
            const errText = await r.text();
            // 根据 status 抛对应的细分错误（借鉴 goose 的 describe_error）
            // 类比：发烧细分到"病毒感冒"vs"细菌感冒"——治法不同
            if (r.status === 401 || r.status === 403) {
              throw new AuthError(`API Key 无效: ${errText.slice(0, 200)}`);
            }
            if (r.status === 429) {
              // Retry-After header 是秒，转成毫秒
              const retryAfter = r.headers.get('retry-after');
              const retryAfterMs = retryAfter
                ? (Number(retryAfter) > 100 ? Number(retryAfter) : Number(retryAfter) * 1000)
                : undefined;
              throw new RateLimitError(`请求太多: ${errText.slice(0, 200)}`, retryAfterMs);
            }
            if (r.status === 402) {
              throw new CreditsExhaustedError(`余额用完: ${errText.slice(0, 200)}`);
            }
            if (r.status === 404) {
              throw new EndpointNotFoundError(`模型不存在: ${errText.slice(0, 200)}`);
            }
            // 其他 4xx/5xx 还是普通 APIError
            throw new APIError(`LLM 错误 ${r.status}: ${errText.slice(0, 200)}`, r.status);
          }
          return r;
        } catch (e: any) {
          // fetch 本身的网络错误（断网、DNS 失败）包装成 NetworkError
          if (e instanceof APIError) throw e; // 已经是 APIError 直接抛
          if (e?.name === 'AbortError') throw e; // 用户主动取消不重试
          throw new NetworkError(`网络错误：${e?.message || e}`);
        }
      },
      { maxRetries: 3, initialDelayMs: 1000 },
      defaultShouldRetry,
    );

    if (!resp.body) throw new NetworkError('响应无 body');

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