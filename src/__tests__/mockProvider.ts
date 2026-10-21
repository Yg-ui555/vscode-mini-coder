/**
 * Mock Provider - 给 AgentLoop 测试用
 *
 * 为什么需要 mock：
 * - 不能在 CI 里调真实 LLM（慢、贵、不稳定）
 * - 不能 mock fetch（ESM 限制）
 * - 最干净：让 Provider 满足 duck type（只要有 stream() 方法就行）
 *
 * 用法：
 *   const provider = new MockProvider([
 *     { content: 'hi' },                          // 第一轮返回文本
 *     { toolCalls: [{ name: 'foo', args: '{}' }] }, // 第二轮调用工具
 *     { content: 'done' },                         // 第三轮返回文本
 *   ]);
 *
 * StreamChunk 结构：
 *   - content?: string  → 流式文本片段
 *   - isFinal?: boolean → 是否最后一帧
 *   - finalResponse?: { content, toolCalls, finishReason }
 */

import type { StreamChunk, LLMResponse } from '../agent/provider';

export interface MockResponse {
  content?: string;
  toolCalls?: Array<{ id?: string; name: string; args: any }>;
}

export class MockProvider {
  /** 预录的 LLM 响应队列，每次 stream() 消费一个 */
  public responses: MockResponse[];
  /** 当前消费到的位置（可被测试 inspect） */
  public callCount = 0;
  /** 每次调用收到的 messages（可被测试 inspect 验证 history 增长） */
  public receivedMessages: any[][] = [];
  /** ⭐ 每次调用收到的 tools 数组（验证"收尾请求不带工具"等行为） */
  public receivedTools: any[][] = [];

  constructor(responses: MockResponse[]) {
    this.responses = responses;
  }

  /** 便捷访问：最后一次调用收到的 tools */
  get lastToolsArg(): any[] {
    return this.receivedTools[this.receivedTools.length - 1] ?? [];
  }

  async *stream(messages: any[], tools: any[] = []): AsyncGenerator<StreamChunk> {
    this.receivedMessages.push(JSON.parse(JSON.stringify(messages)));
    this.receivedTools.push(tools);
    const idx = Math.min(this.callCount, this.responses.length - 1);
    const r = this.responses[idx];
    this.callCount++;

    // 模拟流式：分两次 yield，先 yield 一段 content，再 yield isFinal
    if (r.content) {
      const mid = Math.ceil(r.content.length / 2);
      const part1 = r.content.slice(0, mid);
      const part2 = r.content.slice(mid);
      yield { content: part1 };
      yield { content: part2 };
    }

    const toolCalls = (r.toolCalls || []).map((tc, i) => ({
      id: tc.id || `mock_call_${idx}_${i}`,
      name: tc.name,
      arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args ?? {}),
    }));

    yield {
      isFinal: true,
      finalResponse: {
        content: r.content || null,
        toolCalls,
        finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      } as LLMResponse,
    };
  }
}

/**
 * 简易 Tool Mock - 给 AgentLoop 测试用
 */
export class MockTool {
  readonly name: string;
  readonly description = 'mock tool';
  readonly parameters = { type: 'object', properties: {} };
  /** 记录被调用次数 */
  public invocations: Array<{ args: any }> = [];
  /** 返回结果（每次调用按顺序消费一个） */
  public results: Array<{ content: string; isError?: boolean }>;

  constructor(
    name: string,
    results: Array<{ content: string; isError?: boolean }> = [{ content: 'ok' }],
  ) {
    this.name = name;
    this.results = results;
  }

  async execute(args: any): Promise<{ content: string; isError?: boolean }> {
    this.invocations.push({ args });
    return this.results.shift() ?? { content: 'ok' };
  }
}