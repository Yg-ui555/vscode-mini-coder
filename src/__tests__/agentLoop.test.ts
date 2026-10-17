/**
 * AgentLoop 测试 - 主循环 / 死循环兜底 / autocompact
 *
 * 测试策略：用 MockProvider + MockTool，不依赖真实 LLM
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentLoop } from '../agent/loop';
import { ToolRegistry } from '../agent/tools/registry';
import { MockProvider, MockTool } from './mockProvider';

describe('AgentLoop', () => {
  let registry: ToolRegistry;
  let tool: MockTool;

  beforeEach(() => {
    registry = new ToolRegistry();
    tool = new MockTool('echo', [{ content: 'echo-result' }]);
    registry.register(tool);
  });

  it('should stop when LLM returns text (no tool_calls)', async () => {
    const provider = new MockProvider([{ content: '任务完成' }]);
    const loop = new AgentLoop(provider as any, registry, 5);

    const messages: any[] = [{ role: 'user', content: 'hi' }];
    const result = await loop.run(messages, undefined, {
      onText: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
    });

    expect(result).toBe('任务完成');
    expect(provider.callCount).toBe(1);
  });

  it('should execute tool_calls and continue loop until LLM returns text', async () => {
    const provider = new MockProvider([
      // 第一轮：调用工具
      { toolCalls: [{ name: 'echo', args: { x: 1 } }] },
      // 第二轮：再次调用工具
      { toolCalls: [{ name: 'echo', args: { x: 2 } }] },
      // 第三轮：返回文本（任务完成）
      { content: '搞定' },
    ]);
    const loop = new AgentLoop(provider as any, registry, 10);

    const messages: any[] = [{ role: 'user', content: 'run twice' }];
    const result = await loop.run(messages, undefined, {
      onText: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
    });

    expect(result).toBe('搞定');
    expect(provider.callCount).toBe(3);
    expect(tool.invocations.length).toBe(2);
    expect(tool.invocations[0].args).toEqual({ x: 1 });
    expect(tool.invocations[1].args).toEqual({ x: 2 });
  });

  it('should cap iterations (死循环兜底)', async () => {
    // 一直返回 tool_calls，从不返回文本 → 应该触发 maxIterations
    const provider = new MockProvider([
      { toolCalls: [{ name: 'echo', args: {} }] },
      { toolCalls: [{ name: 'echo', args: {} }] },
      { toolCalls: [{ name: 'echo', args: {} }] },
      { toolCalls: [{ name: 'echo', args: {} }] },
      { toolCalls: [{ name: 'echo', args: {} }] },
    ]);
    const loop = new AgentLoop(provider as any, registry, 3); // maxIterations=3

    const messages: any[] = [{ role: 'user', content: 'loop' }];
    const result = await loop.run(messages, undefined, {
      onText: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
    });

    // 中文 mojibake 兜底：只检查结构化特征（避免 Windows codepage 编码错位）
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/\[.*3.*\]/); // 形如 "[...3]"
    expect(provider.callCount).toBe(3); // 严格 ≤ maxIterations
  });

  it('should pass assistant tool_calls message back to LLM in next round', async () => {
    // 验证 messages 累积正确（这是 OpenAI 协议要求 —— 缺 tool_calls 会 400）
    const provider = new MockProvider([
      { toolCalls: [{ name: 'echo', args: { msg: 'hi' } }] },
      { content: 'done' },
    ]);
    const loop = new AgentLoop(provider as any, registry, 10);

    const messages: any[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
    ];
    await loop.run(messages, undefined, {
      onText: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
    });

    // 第二轮收到的 messages 应该包含 tool_calls assistant 消息 + tool result
    const secondRound = provider.receivedMessages[1];
    expect(secondRound.some((m: any) => m.role === 'assistant' && m.tool_calls)).toBe(true);
    expect(secondRound.some((m: any) => m.role === 'tool' && m.content === 'echo-result')).toBe(true);
  });

  it('should fire onCompact callback when messages exceed threshold', async () => {
    // 构造超大 messages 触发 autocompact（threshold 80k chars）
    const big = 'x'.repeat(40_000);
    const provider = new MockProvider([
      // 第一个响应：compact 总结 LLM 调用（必须返回 content，否则 compact 静默 return）
      { content: 'summary of past messages' },
      // 第二个响应：真正的第一轮
      { content: 'done' },
    ]);
    const loop = new AgentLoop(provider as any, registry, 10);

    const messages: any[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: big }, // 40k chars
      { role: 'user', content: big }, // 40k chars → total 80k+ 触发 compact
      // 必须有 ≥ 7 条 messages，KEEP_RECENT=6 时才能 compact 掉中间部分
      { role: 'assistant', content: big.slice(0, 200) },
      { role: 'user', content: big.slice(0, 200) },
      { role: 'assistant', content: big.slice(0, 200) },
      { role: 'user', content: big.slice(0, 200) },
      { role: 'assistant', content: big.slice(0, 200) },
      { role: 'user', content: 'go' },
    ];

    const compactCalls: string[] = [];
    await loop.run(messages, undefined, {
      onText: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
      onCompact: (msg) => compactCalls.push(msg),
    });

    // 应该至少触发一次 autocompact
    expect(compactCalls.length).toBeGreaterThanOrEqual(1);
    expect(compactCalls[0]).toMatch(/autocompact/);
  });
});