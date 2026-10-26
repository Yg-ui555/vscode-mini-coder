/**
 * Phase 5 三大能力的行为测试
 *
 * ⭐ 这三个能力（Todo / delegate / steering）是 2026 年 agent 岗面试的硬考点，
 *   每一个背后都有一条"铁律"。这个文件测的就是那些铁律：
 *
 *   · Todo   → 最多一个 in_progress；空数组清空；状态独立于消息历史
 *   · delegate → ⭐ 子 agent 物理上改不了文件（不靠提示词）
 *              → 不能递归套娃；如实报告（包括"没找到"）
 *   · steering → 插话只生效一次；顺序保留；空消息不进来
 *
 * ⚠️ 特别强调 delegate 那条：
 *   "子 agent 只能读不能写"这句话，如果只写在 system prompt 里，
 *   它就是一句【愿望】—— 模型不听提示词。
 *   所以这条铁律必须是【结构性的】：工具箱里压根没有写入工具。
 *   下面的测试直接验证这一点，不信任任何提示词。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SteeringQueue, getSteeringQueue } from '../agent/steering';
import { TodoWriteTool } from '../agent/tools/todoWrite';
import { getTodoStore } from '../agent/todo/store';
import {
  createReadOnlyRegistry,
  SUBAGENT_READONLY_TOOLS,
} from '../agent/tools/readonlySet';
import { DelegateTool, setDelegateRuntime, getDelegateDepth } from '../agent/tools/delegate';
import { AgentLoop } from '../agent/loop';
import { MockProvider } from './mockProvider';

/**
 * ⭐ 注入真实的 AgentLoop
 *
 * delegate 工具不 import loop.ts（那样会形成循环依赖），
 * 而是由 loop.ts 在构造时把自己注入进去。
 * 这里手动注入一次，测的就是【真实】的子 agent 行为。
 */
function injectRealAgentLoop(provider: any, model = ''): void {
  setDelegateRuntime({ provider, model, depth: 0, AgentLoopCtor: AgentLoop as any });
}

// ───────────────────────────── steering ─────────────────────────────

describe('SteeringQueue（用户插话队列）', () => {
  let q: SteeringQueue;

  beforeEach(() => {
    q = new SteeringQueue();
  });

  it('push 之后 size 增加，drain 之后清空', () => {
    q.push('第 3 个文件先别动');
    expect(q.size).toBe(1);
    const got = q.drain();
    expect(got).toEqual(['第 3 个文件先别动']);
    expect(q.size).toBe(0);
  });

  it('⭐ drain 取出全部并清空（插话只生效一次）', () => {
    q.push('第一句');
    q.push('第二句');
    expect(q.drain()).toEqual(['第一句', '第二句']);
    // 第二次 drain 必须是空的 —— 否则模型会收到重复的插话
    expect(q.drain()).toEqual([]);
  });

  it('⭐ 保留用户说话的顺序', () => {
    q.push('先说 A');
    q.push('再说 B');
    q.push('最后 C');
    expect(q.drain()).toEqual(['先说 A', '再说 B', '最后 C']);
  });

  it('空白消息直接丢掉（不能让空插话进上下文）', () => {
    q.push('');
    q.push('   ');
    q.push('\n\t');
    expect(q.size).toBe(0);
  });

  it('push 会去掉首尾空白', () => {
    q.push('  有用的内容  ');
    expect(q.drain()).toEqual(['有用的内容']);
  });

  it('clear 清空队列', () => {
    q.push('x');
    q.clear();
    expect(q.size).toBe(0);
  });

  it('全局单例可复用', () => {
    const g = getSteeringQueue();
    g.clear();
    g.push('测试');
    expect(g.size).toBe(1);
    g.clear();
  });
});

// ─────────────────────────────── todo ───────────────────────────────

describe('TodoWriteTool（待办清单）', () => {
  let tool: TodoWriteTool;

  beforeEach(() => {
    tool = new TodoWriteTool();
    getTodoStore().clear();
  });

  it('合法清单会被写进 store，并回报进度', async () => {
    const r = await tool.execute({
      todos: [
        { content: '第一步', status: 'completed' },
        { content: '第二步', status: 'in_progress', activeForm: '正在做第二步' },
        { content: '第三步', status: 'pending' },
      ],
    });
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('1/3');
    expect(r.content).toContain('正在做第二步');
    expect(getTodoStore().get().length).toBe(3);
  });

  it('todos 不是数组 → 报错（不写进 store）', async () => {
    const r = await tool.execute({ todos: 'not an array' as any });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('todos 必须是数组');
    expect(getTodoStore().isEmpty).toBe(true);
  });

  it('某项缺 content → 报错，并指出是第几项', async () => {
    const r = await tool.execute({
      todos: [{ content: '好的', status: 'pending' }, { status: 'pending' } as any],
    });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('第 2 项');
  });

  it('status 非法 → 报错', async () => {
    const r = await tool.execute({
      todos: [{ content: 'x', status: 'doing' as any }],
    });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('status 非法');
  });

  it('⭐ 同时两个 in_progress → 报错（状态会失真）', async () => {
    //  两个 in_progress 意味着"模型认为自己同时在做两件事"，
    //  但它下一轮只能推进一步 —— 那一步推进的是哪一个？
    const r = await tool.execute({
      todos: [
        { content: 'A', status: 'in_progress' },
        { content: 'B', status: 'in_progress' },
      ],
    });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('in_progress');
    expect(getTodoStore().isEmpty).toBe(true);
  });

  it('⭐ 空数组 = 清空清单', async () => {
    await tool.execute({ todos: [{ content: 'x', status: 'pending' }] });
    expect(getTodoStore().isEmpty).toBe(false);

    const r = await tool.execute({ todos: [] });
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('已清空');
    expect(getTodoStore().isEmpty).toBe(true);
  });

  it('store 返回的是副本 —— 外部改了不影响内部状态', async () => {
    await tool.execute({ todos: [{ content: 'x', status: 'pending' }] });
    const copy = getTodoStore().get();
    copy[0].content = '被偷偷改了';
    expect(getTodoStore().get()[0].content).toBe('x');
  });
});

// ───────────────────────────── delegate ─────────────────────────────

describe('子智能体的只读约束（铁律 1）', () => {
  it('⭐ 只读工具集里【物理上】没有任何写入/执行工具', () => {
    const reg = createReadOnlyRegistry();
    const names = reg.names;

    // 存在的应该是这四个
    for (const n of SUBAGENT_READONLY_TOOLS) {
      expect(names).toContain(n);
    }

    // 不该存在的（这是重点）
    for (const forbidden of [
      'apply_patch',
      'write_file',
      'restore_file',
      'run_shell',
      'delegate',
      'todo_write',
      'record_note',
    ]) {
      expect(names, `子 agent 的工具箱里不该有 ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('⭐ 让子 agent 真的去调 apply_patch —— 它调不到', async () => {
    //  这一条是整份文档里最重要的测试：
    //  "子 agent 改不了文件"如果只写在提示词里，就是一句愿望。
    //  这里让 mock provider 真的去调 apply_patch，验证它【调不到】。
    const provider = new MockProvider([
      { toolCalls: [{ name: 'apply_patch', args: { path: 'x.js' } }] },
      { content: '好的，我改不了文件。' },
    ]);

    injectRealAgentLoop(provider as any);
    const tool = new DelegateTool();
    const r = await tool.execute({ task: '把 src/x.js 改一下' });

    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('子智能体结论');
    //  子 agent 用过的工具清单里【不能】出现任何写入工具
    const usedLine = r.content.split('子智能体用过的工具：')[1] || '';
    for (const forbidden of ['apply_patch', 'write_file', 'run_shell']) {
      expect(usedLine).not.toContain(forbidden);
    }

    setDelegateRuntime({ depth: 0 });
  });
});

describe('DelegateTool（子智能体）', () => {
  beforeEach(() => {
    setDelegateRuntime({ provider: null as any, model: '', depth: 0 });
  });

  it('task 为空 → 报错', async () => {
    const r = await new DelegateTool().execute({ task: '   ' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('task 不能为空');
  });

  it('provider 没初始化 → 报错（不崩）', async () => {
    const r = await new DelegateTool().execute({ task: '查一下' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('未初始化');
  });

  it('⭐ 嵌套深度到 1 → 拒绝再派（防无限套娃烧钱）', async () => {
    injectRealAgentLoop(new MockProvider([{ content: 'x' }]) as any);
    setDelegateRuntime({ depth: 1 });
    const r = await new DelegateTool().execute({ task: '再派一个' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('嵌套上限');
    expect(getDelegateDepth()).toBe(1);
    setDelegateRuntime({ depth: 0 });
  });

  it('正常委托 → 返回结论 + 用过的工具清单', async () => {
    const provider = new MockProvider([{ content: '一共 18 处调用。' }]);
    injectRealAgentLoop(provider as any);

    const r = await new DelegateTool().execute({ task: '调查 formatUserId 的调用点' });
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('子智能体结论');
    expect(r.content).toContain('一共 18 处调用。');
    expect(r.content).toContain('子智能体用过的工具');

    // 深度必须还原（否则第二次调用会被误判成"套娃"）
    expect(getDelegateDepth()).toBe(0);
  });

  it('子 agent 没给出结论时如实说明（不编造）', async () => {
    //  mock provider 返回空内容 → 子 agent 的 finalAnswer 是空串
    const provider = new MockProvider([{ content: '' }]);
    injectRealAgentLoop(provider as any);

    const r = await new DelegateTool().execute({ task: '调查一下' });
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('没有给出结论');
  });
});
