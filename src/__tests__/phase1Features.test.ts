/**
 * Phase 1 三个新机制的单元测试（2026-10-24）
 *
 * 覆盖：
 *   A. 双可见性（Dual Visibility）
 *      · filterForModel 过滤掉 agentVisible=false 的消息
 *      · refreshVisibleCallIds 只统计「模型看得见」的 tool 结果
 *   B. 并行工具调用（Partition Tool Calls）
 *      · 只读工具进同一并行批次
 *      · 写/执行工具各自单独一批（串行）
 *      · 批次顺序 == 原始 tool_calls 顺序（防 400 的关键）
 *   C. 重复调用检测（Repeat Guard）
 *      · 四重校验：参数一致 + 内容未变 + 结果 hash 一致 + 结果仍可见
 *      · 关键：结果不可见时【必须】放行（否则信息丢失）
 *      · grep 节流：第 3 次才拦截
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { filterForModel, refreshVisibleCallIds, partitionToolCalls } from '../agent/loop';
import { ToolRegistry } from '../agent/tools/registry';
import { ReadFileTool } from '../agent/tools/readFile';
import { GrepTool } from '../agent/tools/grep';
import { ListDirTool } from '../agent/tools/listDir';
import { ApplyPatchTool } from '../agent/tools/applyPatch';
import { RunShellTool } from '../agent/tools/runShell';
import { RepeatGuard, hashContent } from '../agent/tools/repeatGuard';
import { setVisibleCallIds, getVisibleCallIds } from '../agent/tools/repeatGuard';

// ═══════════════════════════════════════════════════════════
// A. 双可见性
// ═══════════════════════════════════════════════════════════

describe('⭐ 双可见性（Dual Visibility）', () => {
  it('过滤掉 agentVisible=false 的消息', () => {
    const messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '用户说' },
      { role: 'assistant', content: '被压缩的旧历史', agentVisible: false },
      { role: 'assistant', content: '还在的回复' },
    ];
    const visible = filterForModel(messages);
    expect(visible).toHaveLength(3);
    expect(visible.some((m: any) => m.content === '被压缩的旧历史')).toBe(false);
  });

  it('agentVisible=true 的消息【要保留】（别把摘要也滤掉了）', () => {
    const messages = [
      { role: 'system', content: '摘要', agentVisible: true, userVisible: false },
    ];
    expect(filterForModel(messages)).toHaveLength(1);
  });

  it('userVisible=false 不影响模型可见性（那是给 UI 用的标记）', () => {
    const messages = [
      { role: 'system', content: '摘要', agentVisible: true, userVisible: false },
    ];
    expect(filterForModel(messages)).toHaveLength(1);
  });

  it('没标记的消息默认可见（向后兼容）', () => {
    const messages = [{ role: 'user', content: '普通消息' }];
    expect(filterForModel(messages)).toHaveLength(1);
  });

  it('⭐ refreshVisibleCallIds 只统计【模型看得见】的 tool 结果', () => {
    const messages = [
      { role: 'tool', tool_call_id: 'call_1', content: '看得见的结果' },
      { role: 'tool', tool_call_id: 'call_2', content: '被压缩掉的结果', agentVisible: false },
      { role: 'tool', tool_call_id: 'call_3', content: '另一个看得见的' },
    ];
    refreshVisibleCallIds(messages);
    const ids = getVisibleCallIds();

    expect(ids.has('call_1')).toBe(true);
    expect(ids.has('call_2')).toBe(false); // ← 关键：被压缩的结果模型看不见
    expect(ids.has('call_3')).toBe(true);
  });

  it('⭐⭐ 核心不变量：被压缩的 tool 结果【不能】被算作可见', () => {
    // 这条是重复检测第四重校验的基础。
    // 如果这里错了，压缩后 agent 会拿到"文件没变"的提示，
    // 但它其实已经看不到那个文件内容了 → 信息永久丢失。
    const messages = [
      { role: 'tool', tool_call_id: 'call_old', content: '旧结果', agentVisible: false },
    ];
    refreshVisibleCallIds(messages);
    expect(getVisibleCallIds().has('call_old')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// B. 并行工具调用
// ═══════════════════════════════════════════════════════════

describe('⭐ 并行工具调用分批', () => {
  function registry(): ToolRegistry {
    const r = new ToolRegistry();
    r.register(new ReadFileTool());
    r.register(new GrepTool());
    r.register(new ListDirTool());
    r.register(new ApplyPatchTool());
    r.register(new RunShellTool());
    return r;
  }

  const tc = (id: string, name: string) => ({ id, name, arguments: '{}' });

  it('只读工具进同一个并行批次', () => {
    const batches = partitionToolCalls(
      [tc('1', 'read_file'), tc('2', 'grep'), tc('3', 'list_dir')],
      registry(),
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].parallel).toBe(true);
    expect(batches[0].calls).toHaveLength(3);
  });

  it('写工具各自单独一批（防互相覆盖 + 防弹窗冲突）', () => {
    const batches = partitionToolCalls(
      [tc('1', 'apply_patch'), tc('2', 'apply_patch')],
      registry(),
    );
    expect(batches).toHaveLength(2);
    expect(batches[0].parallel).toBe(false);
    expect(batches[1].parallel).toBe(false);
  });

  it('执行工具（run_shell）单独一批', () => {
    const batches = partitionToolCalls([tc('1', 'run_shell')], registry());
    expect(batches).toHaveLength(1);
    expect(batches[0].parallel).toBe(false);
  });

  it('⭐ 混合场景：只读并行 → 写串行 → 只读并行', () => {
    const batches = partitionToolCalls(
      [
        tc('1', 'read_file'),
        tc('2', 'grep'),
        tc('3', 'apply_patch'),
        tc('4', 'read_file'),
      ],
      registry(),
    );
    expect(batches).toHaveLength(3);
    expect(batches[0].parallel).toBe(true);
    expect(batches[0].calls.map((c) => c.id)).toEqual(['1', '2']);
    expect(batches[1].parallel).toBe(false);
    expect(batches[1].calls.map((c) => c.id)).toEqual(['3']);
    expect(batches[2].parallel).toBe(true);
    expect(batches[2].calls.map((c) => c.id)).toEqual(['4']);
  });

  it('⭐⭐ 批次顺序必须与原始 tool_calls 顺序一致（防 400 的关键）', () => {
    const original = [
      tc('a', 'read_file'),
      tc('b', 'apply_patch'),
      tc('c', 'grep'),
      tc('d', 'run_shell'),
      tc('e', 'list_dir'),
    ];
    const batches = partitionToolCalls(original, registry());

    // 把所有批次的 call 摊平，顺序必须跟原始完全一致
    const flattened = batches.flatMap((b) => b.calls.map((c) => c.id));
    expect(flattened).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('未注册的工具按【不可并行】处理（副作用范围未知，保守是对的）', () => {
    const batches = partitionToolCalls([tc('1', '不存在的工具')], registry());
    expect(batches[0].parallel).toBe(false);
  });

  it('空输入返回空批次', () => {
    expect(partitionToolCalls([], registry())).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
// C. 重复调用检测
// ═══════════════════════════════════════════════════════════

describe('⭐ 重复调用检测（Repeat Guard）', () => {
  let guard: RepeatGuard;

  beforeEach(() => {
    guard = new RepeatGuard();
  });

  const HASH_A = hashContent('文件内容 A');
  const HASH_B = hashContent('文件内容 B');

  it('第一次读取不拦截', () => {
    expect(guard.checkRead('/a.ts', undefined, undefined, HASH_A, true)).toBeNull();
  });

  it('⭐ 读过一次、内容没变、结果仍可见 → 拦截并给提示', () => {
    guard.recordRead('/a.ts', undefined, undefined, HASH_A, hashContent('结果'));
    const hint = guard.checkRead('/a.ts', undefined, undefined, HASH_A, true);
    expect(hint).not.toBeNull();
    expect(hint).toContain('unchanged');
  });

  it('⭐⭐ 结果已不在上下文里 → 【必须放行】（否则信息丢失）', () => {
    guard.recordRead('/a.ts', undefined, undefined, HASH_A, hashContent('结果'));
    // isResultStillVisible = false
    const hint = guard.checkRead('/a.ts', undefined, undefined, HASH_A, false);
    expect(hint).toBeNull();
  });

  it('文件内容变了 → 放行（是真的需要重读）', () => {
    guard.recordRead('/a.ts', undefined, undefined, HASH_A, hashContent('结果'));
    const hint = guard.checkRead('/a.ts', undefined, undefined, HASH_B, true);
    expect(hint).toBeNull();
  });

  it('offset 不同 → 放行（参数不一致不算重复）', () => {
    guard.recordRead('/a.ts', 1, 10, HASH_A, hashContent('结果'));
    const hint = guard.checkRead('/a.ts', 5, 10, HASH_A, true);
    expect(hint).toBeNull();
  });

  it('limit 不同 → 放行', () => {
    guard.recordRead('/a.ts', undefined, 10, HASH_A, hashContent('结果'));
    const hint = guard.checkRead('/a.ts', undefined, 20, HASH_A, true);
    expect(hint).toBeNull();
  });

  it('不同文件 → 放行', () => {
    guard.recordRead('/a.ts', undefined, undefined, HASH_A, hashContent('结果'));
    const hint = guard.checkRead('/b.ts', undefined, undefined, HASH_A, true);
    expect(hint).toBeNull();
  });

  it('⭐ 拦截提示不能是 error（必须是信息性提示）', () => {
    guard.recordRead('/a.ts', undefined, undefined, HASH_A, hashContent('结果'));
    const hint = guard.checkRead('/a.ts', undefined, undefined, HASH_A, true)!;
    // 提示里要明确告诉模型"直接用之前的结果"，而不是让它以为工具坏了
    expect(hint).toContain('不要重复读取');
    expect(hint).not.toContain('[错误]');
  });

  it('⭐ grep 节流：前两次放行，第 3 次拦截', () => {
    // 计数语义：先 check 再 record
    //   第 1 次：count=0 → 放行 → record → count=1
    //   第 2 次：count=1 → 放行 → record → count=2
    //   第 3 次：count=2 → 【拦截】
    expect(guard.checkQuery('grep', 'foo|src')).toBeNull();
    guard.recordQuery('grep', 'foo|src');
    expect(guard.checkQuery('grep', 'foo|src')).toBeNull();
    guard.recordQuery('grep', 'foo|src');
    const hint = guard.checkQuery('grep', 'foo|src');
    expect(hint).not.toBeNull();
    expect(hint).toContain('重复查询');
  });

  it('⭐⭐ 工作区被修改后，查询计数必须失效（否则会拦截合法的重搜）', () => {
    // agent grep "TODO" → 改了文件 → 又 grep "TODO"
    // 第二次的结果可能不同（多了一处），必须放行
    guard.recordQuery('grep', 'foo|src');
    guard.recordQuery('grep', 'foo|src');
    expect(guard.checkQuery('grep', 'foo|src')).not.toBeNull(); // 会被拦

    // 写操作发生 → 计数失效
    guard.invalidateQueryCounts();
    expect(guard.checkQuery('grep', 'foo|src')).toBeNull(); // 放行
  });

  it('失效查询计数【不清】读取回执（读取靠内容 hash 自己判断）', () => {
    guard.recordRead('/a.ts', undefined, undefined, HASH_A, hashContent('结果'));
    guard.invalidateQueryCounts();
    // 读取回执还在 —— 文件没变就该复用
    expect(guard.checkRead('/a.ts', undefined, undefined, HASH_A, true)).not.toBeNull();
  });

  it('grep 不同签名不互相影响', () => {
    for (let i = 0; i < 3; i++) guard.recordQuery('grep', 'patternA');
    expect(guard.checkQuery('grep', 'patternB')).toBeNull();
  });

  it('reset 清空所有计数', () => {
    guard.recordRead('/a.ts', undefined, undefined, HASH_A, hashContent('结果'));
    expect(guard.readCount).toBe(1);
    guard.reset();
    expect(guard.readCount).toBe(0);
    expect(guard.checkRead('/a.ts', undefined, undefined, HASH_A, true)).toBeNull();
  });
});
