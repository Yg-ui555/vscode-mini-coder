/**
 * 中断续跑（Run Checkpoint）测试
 *
 * 这个功能最危险的地方在于【副作用被重复执行】：
 *   工具其实跑成功了，快照过时了，恢复时给一条"这个没执行完"，
 *   模型信了，重跑一遍 —— git push 推了两次、文件被删了两次，
 *   而用户完全不知情。
 *
 * 所以测试重点不是"能不能存读"，而是三个决策对不对：
 *   1. 已经跑完的工具，恢复时【绝不能】被声明成"未执行"
 *   2. 真正没跑的工具，必须【显式告知】（不能静默丢弃，也不能假装成功）
 *   3. 整个流程【绝不能】抛异常把面板搞挂
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  hasPendingWork,
  materializeResume,
  describeCheckpoint,
  makeBatchSignature,
  checkpointPath,
  RunCheckpoint,
} from '../../session/resume';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-test-'));
});

afterEach(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

function makeCp(overrides: Partial<RunCheckpoint> = {}): Omit<RunCheckpoint, '_type' | 'updatedAt'> {
  return {
    sessionId: 's-1',
    iteration: 3,
    batchSignature: 'c1,c2',
    done: [
      { id: 'c1', name: 'read_file' },
      { id: 'c2', name: 'grep' },
    ],
    pending: [{ id: 'c3', name: 'apply_patch' }],
    ...overrides,
  };
}

describe('checkpoint 存取', () => {
  it('存了能读回来', () => {
    saveCheckpoint(dir, makeCp());
    const cp = loadCheckpoint(dir, 's-1');

    expect(cp).not.toBeNull();
    expect(cp!.iteration).toBe(3);
    expect(cp!.done).toHaveLength(2);
    expect(cp!.pending).toHaveLength(1);
    expect(cp!._type).toBe('runCheckpoint');
  });

  it('没有快照时返回 null', () => {
    expect(loadCheckpoint(dir, 'never-saved')).toBeNull();
  });

  it('clearCheckpoint 删掉后读不到', () => {
    saveCheckpoint(dir, makeCp());
    clearCheckpoint(dir, 's-1');
    expect(loadCheckpoint(dir, 's-1')).toBeNull();
  });

  it('清一个不存在的快照不抛异常', () => {
    expect(() => clearCheckpoint(dir, 'nope')).not.toThrow();
  });

  it('文件损坏时返回 null 而不是抛异常（坏快照不该让面板打不开）', () => {
    saveCheckpoint(dir, makeCp());
    fs.writeFileSync(checkpointPath(dir, 's-1'), '{ 这不是合法 json', 'utf-8');

    let result: RunCheckpoint | null = null;
    expect(() => {
      result = loadCheckpoint(dir, 's-1');
    }).not.toThrow();
    expect(result).toBeNull();
  });

  it('结构不对的快照被拒绝（缺字段）', () => {
    fs.writeFileSync(
      checkpointPath(dir, 'bad'),
      JSON.stringify({ _type: 'runCheckpoint', sessionId: 'bad' }),
      'utf-8',
    );
    expect(loadCheckpoint(dir, 'bad')).toBeNull();
  });

  it('sessionId 做了路径穿越防护', () => {
    saveCheckpoint(dir, makeCp({ sessionId: '../../evil' }));
    // 清洗后只能落在 dir 里面
    const p = checkpointPath(dir, '../../evil');
    expect(path.resolve(p).startsWith(path.resolve(dir))).toBe(true);
  });

  it('hasPendingWork 只看 pending 是否为空', () => {
    saveCheckpoint(dir, makeCp({ pending: [{ id: 'x', name: 'run_shell' }] }));
    expect(hasPendingWork(loadCheckpoint(dir, 's-1'))).toBe(true);

    saveCheckpoint(dir, makeCp({ pending: [] }));
    expect(hasPendingWork(loadCheckpoint(dir, 's-1'))).toBe(false);

    expect(hasPendingWork(null)).toBe(false);
  });

  it('批次签名：工具 id 拼起来可比对', () => {
    expect(makeBatchSignature([{ id: 'a' }, { id: 'b' }])).toBe('a,b');
    expect(makeBatchSignature([])).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════
describe('materializeResume —— 恢复逻辑的核心', () => {
  // ── 最重要的用例：已完成的绝不能被说成"没执行" ──
  it('已完成结果的工具不会被声明成"未执行"（防副作用被重复执行）', () => {
    const cp: RunCheckpoint = {
      _type: 'runCheckpoint',
      sessionId: 's-1',
      updatedAt: new Date().toISOString(),
      iteration: 3,
      batchSignature: 'c1,c2',
      done: [{ id: 'c1', name: 'run_shell' }],
      pending: [{ id: 'c1', name: 'run_shell' }], // ⭐ 快照过时了
    };

    // messages 里 c1 其实已经有响应了
    const messages = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', tool_call_id: 'c1', content: '命令执行成功：已推送' },
    ];

    const extra = materializeResume(cp, messages);

    // ⭐ 核心断言：不能生成任何"c1 没执行"的声明
    expect(extra).toEqual([]);
    for (const m of extra) {
      expect(m.content ?? '').not.toContain('没有执行');
    }
  });

  it('真正没跑的工具会被显式声明为"未执行"', () => {
    const cp: RunCheckpoint = {
      _type: 'runCheckpoint',
      sessionId: 's-1',
      updatedAt: new Date().toISOString(),
      iteration: 3,
      batchSignature: '',
      done: [{ id: 'c1', name: 'read_file' }],
      pending: [{ id: 'c2', name: 'apply_patch' }],
    };

    const messages = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }, { id: 'c2' }] },
      { role: 'tool', tool_call_id: 'c1', content: '文件内容' },
    ];

    const extra = materializeResume(cp, messages);

    const toolMsg = extra.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBe('c2');
    expect(toolMsg.content).toContain('没有执行');
    // 关键：必须说清楚"没产生任何效果"，让模型知道可以安全重做
    expect(toolMsg.content).toContain('没有产生任何效果');
    // 也必须警告它核实实际状态（万一副作用已经落地了）
    expect(toolMsg.content).toContain('核实');
  });

  it('生成的消息让协议保持合法（每个 tool_call 都有响应）', () => {
    const cp: RunCheckpoint = {
      _type: 'runCheckpoint',
      sessionId: 's-1',
      updatedAt: new Date().toISOString(),
      iteration: 2,
      batchSignature: '',
      done: [{ id: 'c1', name: 'read_file' }],
      pending: [{ id: 'c2', name: 'grep' }],
    };

    const messages = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }, { id: 'c2' }] },
      { role: 'tool', tool_call_id: 'c1', content: 'x' },
    ];

    const restored = [...messages, ...materializeResume(cp, messages)];

    // assistant 声明了 2 个 tool_call，必须有 2 条 tool 响应
    const declared = restored
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => m.tool_calls || [])
      .map((tc: any) => tc.id);
    const answered = restored.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);

    for (const id of declared) {
      expect(answered).toContain(id);
    }
  });

  it('恢复提示里包含"已完成"和"未完成"两边，供模型判断', () => {
    const cp: RunCheckpoint = {
      _type: 'runCheckpoint',
      sessionId: 's-1',
      updatedAt: new Date().toISOString(),
      iteration: 5,
      batchSignature: '',
      done: [{ id: 'c1', name: 'read_file' }, { id: 'c2', name: 'grep' }],
      pending: [{ id: 'c3', name: 'apply_patch' }],
    };

    const messages = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] },
      { role: 'tool', tool_call_id: 'c1', content: 'x' },
      { role: 'tool', tool_call_id: 'c2', content: 'y' },
    ];

    const extra = materializeResume(cp, messages);
    const hint = extra.find((m) => m.role === 'user')!;

    expect(hint.content).toContain('read_file'); // 已完成的
    expect(hint.content).toContain('apply_patch'); // 未完成的
    expect(hint.content).toContain('核实');
    expect(hint.content).toContain('不要从头再来');
  });

  it('全部 pending 都已完成 → 不生成任何消息（快照该被清掉）', () => {
    const cp: RunCheckpoint = {
      _type: 'runCheckpoint',
      sessionId: 's-1',
      updatedAt: new Date().toISOString(),
      iteration: 1,
      batchSignature: '',
      done: [{ id: 'c1', name: 'read_file' }],
      pending: [{ id: 'c1', name: 'read_file' }],
    };

    const messages = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', tool_call_id: 'c1', content: 'done' },
    ];

    expect(materializeResume(cp, messages)).toEqual([]);
  });

  it('pending 为空时什么都不生成', () => {
    const cp: RunCheckpoint = {
      _type: 'runCheckpoint',
      sessionId: 's-1',
      updatedAt: new Date().toISOString(),
      iteration: 1,
      batchSignature: '',
      done: [{ id: 'c1', name: 'read_file' }],
      pending: [],
    };
    expect(materializeResume(cp, [])).toEqual([]);
  });

  it('messages 为空且有待处理 → 仍能生成提示（极端情况不崩）', () => {
    const cp: RunCheckpoint = {
      _type: 'runCheckpoint',
      sessionId: 's-1',
      updatedAt: new Date().toISOString(),
      iteration: 1,
      batchSignature: '',
      done: [],
      pending: [{ id: 'c9', name: 'run_shell' }],
    };

    expect(() => materializeResume(cp, [])).not.toThrow();
    expect(materializeResume(cp, []).length).toBe(2);
  });

  // ── 关键：生成的提示不能误导模型 ──
  it('不把"已完成"和"未完成"说反', () => {
    const cp: RunCheckpoint = {
      _type: 'runCheckpoint',
      sessionId: 's-1',
      updatedAt: new Date().toISOString(),
      iteration: 1,
      batchSignature: '',
      done: [{ id: 'ok', name: 'run_shell' }],
      pending: [{ id: 'todo', name: 'apply_patch' }],
    };

    const messages = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'ok' }, { id: 'todo' }] },
      { role: 'tool', tool_call_id: 'ok', content: '部署成功' },
    ];

    const extra = materializeResume(cp, messages);
    const hint = extra.find((m) => m.role === 'user')!.content;

    // 完成的工具出现在"已经执行完成"那一行
    const doneLine = hint.split('\n').find((l: string) => l.includes('已经执行完成'))!;
    expect(doneLine).toContain('run_shell');
    expect(doneLine).not.toContain('apply_patch');

    // 未完成的出现在"没执行完"那一行
    const pendingLine = hint.split('\n').find((l: string) => l.includes('没执行完'))!;
    expect(pendingLine).toContain('apply_patch');
    expect(pendingLine).not.toContain('run_shell');
  });
});

describe('describeCheckpoint', () => {
  it('包含轮次、已完成数、未完成工具名', () => {
    saveCheckpoint(dir, makeCp());
    const cp = loadCheckpoint(dir, 's-1')!;
    const text = describeCheckpoint(cp);

    expect(text).toContain('第 4 轮'); // iteration 是 0-based，展示时 +1
    expect(text).toContain('已完成 2');
    expect(text).toContain('apply_patch');
  });
});

// ══════════════════════════════════════════════════════════════
describe('端到端：中断 → 存快照 → 读回 → 恢复', () => {
  it('完整链路', () => {
    // 1. 模拟：一批 3 个工具，做了 1 个就中断
    const done = [{ id: 'c1', name: 'read_file' }];
    const pending = [
      { id: 'c2', name: 'grep' },
      { id: 'c3', name: 'apply_patch' },
    ];
    saveCheckpoint(dir, { sessionId: 's-x', iteration: 7, batchSignature: 'c1,c2,c3', done, pending });

    // 2. 会话历史里：c1 有响应，c2/c3 是 loop 中断时补的"未执行"说明
    //    （注意真实的 messages 里它们已经被补齐了，所以恢复时不会重复补）
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: '帮我改个 bug' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
      },
      { role: 'tool', tool_call_id: 'c1', content: '文件内容' },
      { role: 'tool', tool_call_id: 'c2', content: '[用户中断了本次任务，该工具未执行]' },
      { role: 'tool', tool_call_id: 'c3', content: '[用户中断了本次任务，该工具未执行]' },
    ];

    // 3. 读回并恢复
    const cp = loadCheckpoint(dir, 's-x')!;
    const extra = materializeResume(cp, messages);

    // 中断时 loop 已经补齐了 c2/c3，所以恢复时不重复补声明
    expect(extra).toEqual([]);

    // 但仍然清掉快照，表示"这次恢复处理完了"
    clearCheckpoint(dir, 's-x');
    expect(loadCheckpoint(dir, 's-x')).toBeNull();
  });

  it('更常见的场景：编辑器被关掉，messages 里没有补位消息', () => {
    // 1. 存档时只做到 c1（c2/c3 还没执行，进程就没了）
    saveCheckpoint(dir, {
      sessionId: 's-y',
      iteration: 4,
      batchSignature: 'c1,c2',
      done: [{ id: 'c1', name: 'read_file' }],
      pending: [{ id: 'c2', name: 'run_shell' }],
    });

    // 2. 持久化只来得及写用户消息 + assistant 的 tool_calls（c2 没响应）
    //    —— 注意这正是 historyRepair 要修的场景，两处必须协同
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: '跑一下测试' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1' }, { id: 'c2' }],
      },
      { role: 'tool', tool_call_id: 'c1', content: '文件内容' },
    ];

    const cp = loadCheckpoint(dir, 's-y')!;
    const extra = materializeResume(cp, messages);

    // c2 确实没有响应 → 补一条明确的说明
    const filled = extra.filter((m) => m.role === 'tool');
    expect(filled).toHaveLength(1);
    expect(filled[0].tool_call_id).toBe('c2');
    expect(filled[0].content).toContain('没有产生任何效果');
  });
});