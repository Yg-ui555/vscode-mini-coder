/**
 * Operation 管线测试
 *
 * ⭐ 这个文件测的是【管线】本身，不是业务功能：
 *   每个 Operation 给一个假上下文就能单独测 —— 这是管线化最大的收益之一
 *   （改造前这些逻辑全在一个 1000 行的 while 循环里，根本没法单独测）。
 *
 * ⭐⭐ 重点测一条真实踩过的坑：
 *   "上下文压缩之后，待办清单还在不在？"
 *   答案必须是"在" —— 这是 Phase 5.1 的核心验收点。
 *   详见下面「⭐⭐ 压缩不能把待办状态压掉」那一组。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OperationContext } from '../agent/operations/types';
import { todoInjectOperation } from '../agent/operations/todoInject';
import { steerInjectOperation } from '../agent/operations/steerInject';
import { contextGuardOperation } from '../agent/operations/contextGuard';
import { abortOperation } from '../agent/operations/abort';
import { maxIterationsOperation } from '../agent/operations/maxIterations';
import { ALL_OPERATION_NAMES, buildPipeline } from '../agent/operations';
import { getTodoStore } from '../agent/todo/store';
import { getSteeringQueue } from '../agent/steering';
import { filterForModel } from '../agent/visibility';
import { ToolRegistry } from '../agent/tools/registry';
import { MockProvider } from './mockProvider';

// ── 造一个假上下文 ──────────────────────────────────────────
function makeCtx(overrides: Partial<OperationContext> = {}): OperationContext {
  return {
    messages: [],
    signal: undefined,
    callbacks: {
      onText: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
    },
    iteration: 0,
    provider: new MockProvider([{ content: 'ok' }]) as any,
    registry: new ToolRegistry(),
    model: '',
    contextWindow: 100000,
    maxIterations: 10,
    state: { tokenTotal: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    ...overrides,
  };
}

describe('管线组装', () => {
  it('每个注册名都能在管线里找到', () => {
    const names = buildPipeline().map((o) => o.name);
    for (const n of ALL_OPERATION_NAMES) {
      expect(names).toContain(n);
    }
  });

  it('⭐ todo_inject 排在 context_guard 之前（插话/待办要在压缩前生效）', () => {
    const names = buildPipeline().map((o) => o.name);
    expect(names.indexOf('todo_inject')).toBeLessThan(names.indexOf('context_guard'));
    expect(names.indexOf('steer_inject')).toBeLessThan(names.indexOf('context_guard'));
  });

  it('context_guard 排在 inference 之前（压缩必须在发请求之前）', () => {
    const names = buildPipeline().map((o) => o.name);
    expect(names.indexOf('context_guard')).toBeLessThan(names.indexOf('inference'));
  });
});

describe('abort Operation', () => {
  it('没中断时不适用', async () => {
    const ctx = makeCtx();
    const r = await abortOperation.run(ctx);
    expect(r.status).toBe('not_applicable');
  });

  it('中断时直接结束并给出提示', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const ctx = makeCtx({ signal: ctrl.signal });
    const r = await abortOperation.run(ctx);
    expect(r.status).toBe('yielded');
    expect((r as any).output).toContain('中断');
  });
});

describe('maxIterations Operation', () => {
  it('没到上限时不适用', async () => {
    const ctx = makeCtx({ iteration: 0, maxIterations: 10 });
    const r = await maxIterationsOperation.run(ctx);
    expect(r.status).toBe('not_applicable');
  });

  it('到上限时结束（触顶兜底交给上层做总结）', async () => {
    const ctx = makeCtx({ iteration: 10, maxIterations: 10 });
    const r = await maxIterationsOperation.run(ctx);
    expect(r.status).toBe('yielded');
  });
});

describe('todoInject Operation', () => {
  beforeEach(() => {
    getTodoStore().clear();
    getSteeringQueue().clear();
  });

  it('没有待办时不适用', async () => {
    const ctx = makeCtx();
    const r = await todoInjectOperation.run(ctx);
    expect(r.status).toBe('not_applicable');
    expect(ctx.messages.length).toBe(0);
  });

  it('有待办时注入一条 system 消息', async () => {
    getTodoStore().replace([
      { content: '实现 parser', status: 'in_progress', activeForm: '正在实现 parser' },
      { content: '写测试', status: 'pending' },
    ]);

    const ctx = makeCtx();
    const r = await todoInjectOperation.run(ctx);
    expect(r.status).toBe('applied');
    expect(ctx.messages.length).toBe(1);
    expect(ctx.messages[0].role).toBe('system');
    expect(ctx.messages[0].content).toContain('实现 parser');
    expect(ctx.messages[0].content).toContain('进度：0/2');
  });

  it('⭐ 第二次注入是【替换】不是【追加】（否则上下文会堆 N 份快照）', async () => {
    getTodoStore().replace([{ content: '第一步', status: 'pending' }]);
    const ctx = makeCtx();

    await todoInjectOperation.run(ctx);
    expect(ctx.messages.length).toBe(1);

    getTodoStore().replace([{ content: '第一步', status: 'completed' }]);
    await todoInjectOperation.run(ctx);

    // ⭐ 还是一条，而且内容更新了
    expect(ctx.messages.length).toBe(1);
    expect(ctx.messages[0].content).toContain('进度：1/1');
  });

  it('清单清空后把之前注入的那条删掉', async () => {
    getTodoStore().replace([{ content: '第一步', status: 'pending' }]);
    const ctx = makeCtx();
    await todoInjectOperation.run(ctx);
    expect(ctx.messages.length).toBe(1);

    getTodoStore().clear();
    await todoInjectOperation.run(ctx);
    expect(ctx.messages.length).toBe(0);
  });

  it('⭐ 注入的消息带 pinned 标记（永不参与压缩）', async () => {
    getTodoStore().replace([{ content: '第一步', status: 'pending' }]);
    const ctx = makeCtx();
    await todoInjectOperation.run(ctx);
    expect(ctx.messages[0].pinned).toBe(true);
  });
});

describe('steerInject Operation', () => {
  beforeEach(() => {
    getTodoStore().clear();
    getSteeringQueue().clear();
  });

  it('队列为空时不适用', async () => {
    const ctx = makeCtx({ state: { tokenTotal: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, steeringQueue: [] } });
    const r = await steerInjectOperation.run(ctx);
    expect(r.status).toBe('not_applicable');
  });

  it('⭐ 插话被注入成 user 消息，并且【只注入一次】', async () => {
    const queue = getSteeringQueue().pending;
    queue.push('第 3 个文件先别动');

    const ctx = makeCtx({
      state: {
        tokenTotal: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        steeringQueue: queue,
      },
    });

    const r = await steerInjectOperation.run(ctx);
    expect(r.status).toBe('applied');
    expect(ctx.messages.length).toBe(1);
    expect(ctx.messages[0].role).toBe('user');
    expect(ctx.messages[0].content).toContain('第 3 个文件先别动');

    // 再跑一次不应该重复注入
    await steerInjectOperation.run(ctx);
    expect(ctx.messages.length).toBe(1);
  });
});

describe('⭐⭐ 压缩不能把待办状态压掉', () => {
  beforeEach(() => {
    getTodoStore().clear();
    getSteeringQueue().clear();
  });

  it('待办消息在压缩后仍然对模型可见', async () => {
    // 1. 注入待办
    getTodoStore().replace([
      { content: '第一步', status: 'completed' },
      { content: '第二步', status: 'in_progress' },
      { content: '第三步', status: 'pending' },
    ]);
    const ctx = makeCtx();
    await todoInjectOperation.run(ctx);
    const todoMsg = ctx.messages[0];

    // 2. 造一堆超长历史，把上下文撑到触发压缩
    ctx.contextWindow = 2000; // 阈值 = 2000 * 0.7 = 1400 token
    ctx.messages.unshift({ role: 'system', content: '系统提示' });
    for (let i = 0; i < 30; i++) {
      ctx.messages.push({
        role: 'user',
        content: `第 ${i} 条历史消息`.repeat(200), // 每条约 2000+ token
      });
      ctx.messages.push({
        role: 'assistant',
        content: `回复 ${i} `.repeat(200),
      });
    }

    // 3. 触发压缩
    //    provider 是个 MockProvider，会返回一段固定内容当摘要
    const r = await contextGuardOperation.run(ctx);
    expect(r.status).toBe('applied');

    // 4. ⭐ 关键断言：待办消息还在，而且【对模型可见】
    const stillThere = ctx.messages.find((m: any) => m.__todo_state === true);
    expect(stillThere).toBeTruthy();
    expect(stillThere.agentVisible).not.toBe(false);

    // 5. ⭐ 更直接的断言：发给模型的那份 messages 里能看到待办
    const visible = filterForModel(ctx.messages);
    const visibleTodo = visible.find((m: any) => m.__todo_state === true);
    expect(visibleTodo).toBeTruthy();
    expect(visibleTodo.content).toContain('第二步');
  });

  it('普通历史消息压缩后确实对模型隐藏了（对照组：证明压缩真的发生了）', async () => {
    const ctx = makeCtx();
    ctx.contextWindow = 2000;
    ctx.messages.unshift({ role: 'system', content: '系统提示' });
    for (let i = 0; i < 30; i++) {
      ctx.messages.push({ role: 'user', content: `历史 ${i} `.repeat(200) });
      ctx.messages.push({ role: 'assistant', content: `回复 ${i} `.repeat(200) });
    }

    await contextGuardOperation.run(ctx);

    const visible = filterForModel(ctx.messages);
    const visibleUserMsgs = visible.filter((m: any) => m.role === 'user');
    // 压缩后只剩最近 KEEP_RECENT_MESSAGES(12) 条
    expect(visibleUserMsgs.length).toBeLessThan(30);
  });
});
