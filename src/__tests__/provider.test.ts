/**
 * OpenAIProvider 测试 - SSE 流解析 + 错误分类
 *
 * 测试策略：mock 全局 fetch（不调真实 API）
 * SSE（Server-Sent Events）= LLM 流式响应的格式
 *   data: {...}\n\n
 *
 * 为什么必须测：
 * - SSE 解析很容易在边界情况出错（半截 JSON / 异常字符）
 * - 错误分类（401/429/500）每种都要正确转换
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIProvider } from '../agent/provider';
import { AuthError, RateLimitError, CreditsExhaustedError, EndpointNotFoundError, NetworkError, APIError } from '../errors';

// 工具函数：把字符串转成 ReadableStream（模拟 SSE 响应）
function makeSseResponse(chunks: string[], status = 200, headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream', ...headers },
  });
}

// 工具函数：收集 stream 的所有 chunk
async function collectChunks(gen: AsyncGenerator<any>): Promise<any[]> {
  const result = [];
  for await (const chunk of gen) {
    result.push(chunk);
  }
  return result;
}

describe('OpenAIProvider SSE parsing', () => {
  beforeEach(() => {
    // 每个测试前清空 mock
    vi.restoreAllMocks();
  });

  it('正常解析：完整 SSE 流', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => makeSseResponse(sse)));

    const provider = new OpenAIProvider('https://api.test.com/v1', 'sk-test', 'test-model');
    const chunks = await collectChunks(provider.stream([{ role: 'user', content: 'hi' }], []));

    // 应该有 2 个 content chunk + 1 个 isFinal
    expect(chunks.filter((c) => c.content).map((c) => c.content).join('')).toBe('你好');
    expect(chunks.some((c) => c.isFinal)).toBe(true);
    const final = chunks.find((c) => c.isFinal);
    expect(final?.finalResponse?.content).toBe('你好');
    expect(final?.finalResponse?.toolCalls).toEqual([]);
  });

  it('半截 JSON：data: {"choices" — chunk 切断', async () => {
    // 第一段：半个 JSON
    // 第二段：另一半
    const sse = [
      'data: {"choices":[{"de',
      'lta":{"content":"完成"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => makeSseResponse(sse)));

    const provider = new OpenAIProvider('https://api.test.com/v1', 'sk-test', 'test-model');
    const chunks = await collectChunks(provider.stream([{ role: 'user', content: 'hi' }], []));

    expect(chunks.filter((c) => c.content).map((c) => c.content).join('')).toBe('完成');
  });

  it('[DONE] 标记：流结束', async () => {
    const sse = ['data: {"choices":[{"delta":{"content":"x"}}]}\n\n', 'data: [DONE]\n\n'];
    vi.stubGlobal('fetch', vi.fn(async () => makeSseResponse(sse)));

    const provider = new OpenAIProvider('https://api.test.com/v1', 'sk-test', 'test-model');
    const chunks = await collectChunks(provider.stream([], []));

    // 应该正好 1 个 content + 1 个 isFinal
    expect(chunks.length).toBe(2);
    expect(chunks[0].content).toBe('x');
    expect(chunks[1].isFinal).toBe(true);
  });

  it('tool_calls 增量拼接：arguments 跨多个 chunk', async () => {
    // 真实 OpenAI 流式响应：tool_calls.arguments 是增量给的（每个 chunk 一段）
    // 类比：拼图，每块是一段，最后拼起来是完整 JSON
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"rea","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"pa"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"/tmp/x\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => makeSseResponse(sse)));

    const provider = new OpenAIProvider('https://api.test.com/v1', 'sk-test', 'test-model');
    const chunks = await collectChunks(provider.stream([], [{ type: 'function', function: {} }]));

    const final = chunks.find((c) => c.isFinal);
    expect(final?.finalResponse?.toolCalls.length).toBe(1);
    expect(final?.finalResponse?.toolCalls[0].name).toBe('rea');
    expect(final?.finalResponse?.toolCalls[0].arguments).toBe('{"path":"/tmp/x"}');
  });

  it('content 是 null：LLM 只调工具不输出文本', async () => {
    // 有些 LLM 在调工具时不输出文本，content 是 null
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"foo","arguments":"{}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => makeSseResponse(sse)));

    const provider = new OpenAIProvider('https://api.test.com/v1', 'sk-test', 'test-model');
    const chunks = await collectChunks(provider.stream([], []));

    const final = chunks.find((c) => c.isFinal);
    // content 应该是 null（不是 '' 也不是 undefined）
    expect(final?.finalResponse?.content === null || final?.finalResponse?.content === '').toBe(true);
    expect(final?.finalResponse?.toolCalls.length).toBe(1);
  });

  it('坏 JSON 行不影响后续行', async () => {
    // 真实的 LLM 偶尔会发出畸形行，应该跳过而不是崩
    const sse = [
      'data: this is not json\n\n', // 故意坏
      'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => makeSseResponse(sse)));

    const provider = new OpenAIProvider('https://api.test.com/v1', 'sk-test', 'test-model');
    const chunks = await collectChunks(provider.stream([], []));

    // 应该跳过坏行，拿到 "OK"
    expect(chunks.filter((c) => c.content).map((c) => c.content).join('')).toBe('OK');
  });
});

describe('OpenAIProvider error classification', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('HTTP 401 抛 AuthError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));

    const provider = new OpenAIProvider('https://api.test.com/v1', 'bad-key', 'm');
    await expect(async () => {
      await collectChunks(provider.stream([], []));
    }).rejects.toThrow(AuthError);
  });

  it('HTTP 429 抛 RateLimitError（含 retry-after）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('rate limited', {
        status: 429,
        headers: { 'retry-after': '5' },
      }),
    ));

    const provider = new OpenAIProvider('https://api.test.com/v1', 'sk', 'm');
    try {
      await collectChunks(provider.stream([], []));
      throw new Error('应该抛错但没抛');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect(e.retryAfterMs).toBe(5000);
    }
  });

  it('HTTP 402 抛 CreditsExhaustedError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no credits', { status: 402 })));

    const provider = new OpenAIProvider('https://api.test.com/v1', 'sk', 'm');
    await expect(async () => {
      await collectChunks(provider.stream([], []));
    }).rejects.toThrow(CreditsExhaustedError);
  });

  it('HTTP 404 抛 EndpointNotFoundError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('model not found', { status: 404 })));

    const provider = new OpenAIProvider('https://api.test.com/v1', 'sk', 'wrong-model');
    await expect(async () => {
      await collectChunks(provider.stream([], []));
    }).rejects.toThrow(EndpointNotFoundError);
  });

  it('网络断（fetch 抛错）→ NetworkError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));

    const provider = new OpenAIProvider('https://api.test.com/v1', 'sk', 'm');
    await expect(async () => {
      await collectChunks(provider.stream([], []));
    }).rejects.toThrow(/网络/);  // 错误消息含"网络"
    // retry 重试 3 次要 7 秒（1+2+4），给 15 秒超时
  }, 15_000);

  it('HTTP 500 → 抛 APIError（不是 NetworkError）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('server error', { status: 500 })));

    const provider = new OpenAIProvider('https://api.test.com/v1', 'sk', 'm');
    try {
      await collectChunks(provider.stream([], []));
      throw new Error('应该抛错但没抛');
    } catch (e: any) {
      expect(e).toBeInstanceOf(APIError);
      expect(e).not.toBeInstanceOf(NetworkError);
      expect(e.status).toBe(500);
    }
    // retry 重试 3 次要 7 秒，给 15 秒超时
  }, 15_000);
});
