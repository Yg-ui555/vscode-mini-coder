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

    // 触顶后【多了一次收尾总结请求】：借鉴 nanobot 的 _try_finalize_after_max_iterations
    // ——用户最需要的是"它到底干了啥"，不是一句"超限了"
    // 所以 callCount = maxIterations(3) + 1(无工具收尾) = 4
    // ⚠️ 收尾请求【不注册工具】：如果带了 tools，LLM 可能又想调工具，收尾就收不住
    expect(provider.callCount).toBe(4);
    expect(provider.lastToolsArg).toEqual([]); // 关键：最后一次不带工具
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
    // ⭐ 2026-10-21：压缩触发条件从"8 万字符"改成"上下文窗口的 70%"。
    //    这里用中文构造大内容，顺带验证 util/tokens.ts 的 CJK 估算路径。
    //    7 万汉字 ≈ 50000 token > 64000 × 0.7 = 44800 → 触发。
    const big = '中'.repeat(70_000);
    const provider = new MockProvider([
      // 第一个响应：compact 总结 LLM 调用（必须返回 content，否则 compact 静默 return）
      { content: 'summary of past messages' },
      // 第二个响应：真正的第一轮
      { content: 'done' },
    ]);
    const loop = new AgentLoop(provider as any, registry, 10);

    const messages: any[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: big }, // 中文 7 万字
      { role: 'user', content: big }, // 再加 7 万字
      // 必须有足够多的 messages，KEEP_RECENT=12 时才能 compact 掉中间部分
      { role: 'assistant', content: big.slice(0, 200) },
      { role: 'user', content: big.slice(0, 200) },
      { role: 'assistant', content: big.slice(0, 200) },
      { role: 'user', content: big.slice(0, 200) },
      { role: 'assistant', content: big.slice(0, 200) },
      { role: 'user', content: big.slice(0, 200) },
      { role: 'assistant', content: big.slice(0, 200) },
      { role: 'user', content: big.slice(0, 200) },
      { role: 'assistant', content: big.slice(0, 200) },
      { role: 'user', content: big.slice(0, 200) },
      // ⚠️ 消息条数必须 > KEEP_RECENT_MESSAGES(12) + system + 1 = 14 条，
      //    否则 maybeCompact 会走"没东西可压缩"的保护性 return。
      //    下面这两条把总数补到 16 条。
      { role: 'assistant', content: big.slice(0, 200) },
      { role: 'user', content: '继续' },
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

  // ============ 新增边界测试 ============

  it('should keep going when tool throws (not crash main loop)', async () => {
    // 工具抛错不应该让主循环崩
    // 类比：店里一个服务员摔倒了，其他服务员继续干活
    const errorTool = new MockTool('crash', [{ content: 'boom', isError: true }]);
    const recoveryReg = new ToolRegistry();
    recoveryReg.register(errorTool);

    const provider = new MockProvider([
      // 第 1 轮：调用工具（会失败）
      { toolCalls: [{ name: 'crash', args: {} }] },
      // 第 2 轮：工具失败后 LLM 看到结果，返回文本
      { content: '工具失败了但我能继续' },
    ]);
    const loop = new AgentLoop(provider as any, recoveryReg, 10);

    const messages: any[] = [{ role: 'user', content: '试试工具' }];
    const result = await loop.run(messages, undefined, {
      onText: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
    });

    expect(result).toBe('工具失败了但我能继续');
    expect(errorTool.invocations.length).toBe(1);
    // 验证：失败的工具结果也被塞回 messages，下一轮 LLM 能看到
    expect(provider.receivedMessages[1].some((m: any) => m.role === 'tool')).toBe(true);
  });

  it('should fallback to empty args when tool arguments is invalid JSON', async () => {
    // LLM 返回的 tool arguments 可能是坏 JSON（边界 case）
    // 类比：快递单地址写错了，你别报错，先按默认地址送
    const provider = new MockProvider([
      // 故意传坏 JSON
      { toolCalls: [{ name: 'echo', args: '{not valid json' }] },
      { content: 'ok' },
    ]);
    const loop = new AgentLoop(provider as any, registry, 10);

    const messages: any[] = [{ role: 'user', content: 'go' }];
    await loop.run(messages, undefined, {
      onText: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
    });

    // 验证：工具被调用时收到空 args（不是抛错）
    expect(tool.invocations.length).toBe(1);
    expect(tool.invocations[0].args).toEqual({});
  });
});