/**
 * 历史自愈（historyRepair）测试
 *
 * 为什么这组测试重要：
 *   它守护的是"provider 会不会直接返回 400"这条红线。
 *   修复前的代码在两种真实场景下会产出非法结构：
 *     1. 用户在多工具调用时点"停止" → 中断只补了当前那一个
 *     2. autocompact 把带 tool_calls 的 assistant 压成摘要
 *        → 保留下来的 tool 结果全成孤儿
 *   这两种都不会抛异常、不会有日志，只会安静地在【下次打开对话时】炸掉。
 *
 * 所以这里不只测"函数返回了什么"，还用 validateMessages 断言
 * "修复后的结构一定符合协议"。
 */

import { describe, it, expect } from 'vitest';
import { repairMessages, validateMessages } from '../../util/historyRepair';

/** 造一条 assistant + tool 的完整回合 */
function turn(id: string, toolName = 'read_file') {
  return {
    assistant: {
      role: 'assistant',
      content: '',
      tool_calls: [{ id, type: 'function', function: { name: toolName, arguments: '{}' } }],
    },
    tool: { role: 'tool', tool_call_id: id, content: '结果内容' },
  };
}

describe('historyRepair', () => {
  // ────────────────────────────────────────────────────────────
  // 场景 1：中断留下的孤儿（本项目真实踩过的坑）
  // ────────────────────────────────────────────────────────────
  describe('中断场景', () => {
    it('补齐 3 个 tool_call 只响应 2 个造成的孤儿', () => {
      const messages = [
        { role: 'system', content: '系统提示' },
        { role: 'user', content: '干活' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{}' } },
            { id: 'call_b', type: 'function', function: { name: 'grep', arguments: '{}' } },
            { id: 'call_c', type: 'function', function: { name: 'list_dir', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_a', content: '文件内容' },
        { role: 'tool', tool_call_id: 'call_b', content: '[用户中断了本次任务，该工具未执行]' },
        // call_c 没有响应 —— 就是这个 bug
      ];

      expect(validateMessages(messages)).not.toBeNull(); // 先确认坏数据确实非法

      const result = repairMessages(messages);

      expect(result.filledOrphans).toBe(1);
      expect(result.changed).toBe(true);

      const toolMsgs = result.messages.filter((m) => m.role === 'tool');
      expect(toolMsgs).toHaveLength(3);

      // ⭐ 核心断言：修复后必须符合协议，否则发给 provider 就是 400
      expect(validateMessages(result.messages)).toBeNull();
    });

    it('补齐的响应按 tool_calls 声明顺序，且 tool_call_id 正确', () => {
      const messages = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'x1', type: 'function', function: { name: 'grep', arguments: '{}' } },
            { id: 'x2', type: 'function', function: { name: 'read_file', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'x2', content: '第二个的结果' },
        // x1 缺失（注意：已响应的是 x2，不是 x1）
      ];

      const result = repairMessages(messages);
      const toolMsgs = result.messages.filter((m) => m.role === 'tool');

      expect(result.filledOrphans).toBe(1);
      expect(toolMsgs).toHaveLength(2);
      // 补出来的 x1 必须排在声明顺序里（x1 在前），且 id 正确
      expect(toolMsgs[0].tool_call_id).toBe('x1');
      expect(toolMsgs[1].tool_call_id).toBe('x2');
      expect(validateMessages(result.messages)).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────
  // 场景 2：autocompact 把 assistant 压掉导致 tool 变孤儿
  // ────────────────────────────────────────────────────────────
  describe('autocompact 场景', () => {
    it('处理"摘要后面全是 tool 结果、却没有任何 assistant 声明"的非法结构', () => {
      // 这就是旧版 autocompact 产出的结构
      const messages = [
        { role: 'system', content: '系统提示' },
        { role: 'system', content: '[Earlier conversation summary] 之前的对话摘要…' },
        { role: 'tool', tool_call_id: 'old_1', content: '很早以前跑的结果' },
        { role: 'tool', tool_call_id: 'old_2', content: '更早以前跑的结果' },
        { role: 'user', content: '继续' },
      ];

      expect(validateMessages(messages)).toContain('孤立 tool 消息');

      const result = repairMessages(messages);

      expect(result.handledStrays).toBe(2);
      expect(result.changed).toBe(true);

      // ⭐ 关键：会插入一条【合成的 assistant 声明】把这片 tool 兜住。
      //   少这一条，协议就是非法的（跟内容写成什么没关系）。
      expect(result.messages).toHaveLength(messages.length + 1);
      const synthetic = result.messages.find((m) => m._synthetic);
      expect(synthetic).toBeDefined();
      expect(synthetic.role).toBe('assistant');
      expect(synthetic.tool_calls.map((tc: any) => tc.id)).toEqual(['old_1', 'old_2']);

      // 内容被换成说明，让模型知道"这里调用过但没结果"
      const firstStray = result.messages.find((m) => m.tool_call_id === 'old_1');
      expect(firstStray.content).toContain('请不要假定它已经执行过');

      expect(validateMessages(result.messages)).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────
  // 场景 3：孤立 tool 消息（反过来，没有 tool_call 声明）
  // ────────────────────────────────────────────────────────────
  describe('孤立 tool 消息', () => {
    it('有 id 但找不到出处时，补一条合成声明兜住它（而不是只换内容）', () => {
      const messages = [
        { role: 'user', content: '你好' },
        { role: 'tool', tool_call_id: 'ghost', content: '我是从哪来的？' },
      ];

      const result = repairMessages(messages);

      expect(result.handledStrays).toBe(1);
      // 2 条原始消息 + 1 条合成 assistant 声明
      expect(result.messages).toHaveLength(3);

      const synthetic = result.messages.find((m) => m._synthetic);
      expect(synthetic).toBeDefined();
      expect(synthetic.tool_calls[0].id).toBe('ghost');

      // 原始 tool 消息保留，但内容换成说明（保住可追溯性）
      const kept = result.messages.find((m) => m.tool_call_id === 'ghost');
      expect(kept.content).toContain('请不要假定它已经执行过');

      expect(validateMessages(result.messages)).toBeNull();
    });

    it('连 tool_call_id 都没有时直接删除（无可追溯性，留着只是噪声）', () => {
      const messages = [
        { role: 'user', content: '你好' },
        { role: 'tool', content: '我是谁？我不知道' },
      ];

      const result = repairMessages(messages);

      // 无 id 计入的是 droppedNoId（丢弃），不是 handledStrays（补声明）
      expect(result.droppedNoId).toBe(1);
      expect(result.handledStrays).toBe(0);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(validateMessages(result.messages)).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────
  // 正常数据绝对不能被破坏（这是最重要的一组）
  // ────────────────────────────────────────────────────────────
  describe('不误伤正常数据', () => {
    it('完全合法的多轮工具调用原样返回', () => {
      const a = turn('t1');
      const b = turn('t2', 'grep');
      const messages = [
        { role: 'system', content: '系统提示' },
        { role: 'user', content: '第一件事' },
        a.assistant,
        a.tool,
        { role: 'assistant', content: '做完了第一件事' },
        { role: 'user', content: '第二件事' },
        b.assistant,
        b.tool,
        { role: 'assistant', content: '全部完成' },
      ];

      const result = repairMessages(messages);

      expect(result.changed).toBe(false);
      expect(result.filledOrphans).toBe(0);
      expect(result.handledStrays).toBe(0);
      expect(result.messages).toHaveLength(messages.length);
      expect(validateMessages(result.messages)).toBeNull();
    });

    it('纯对话（没有任何工具调用）完全不改动', () => {
      const messages = [
        { role: 'system', content: '系统提示' },
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好，有什么可以帮你' },
      ];

      const result = repairMessages(messages);

      expect(result.changed).toBe(false);
      expect(result.messages).toEqual(messages);
    });

    it('不修改传入的原数组（避免污染 session store 的内存态）', () => {
      const messages = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'k1', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
        },
        // 缺响应
      ];
      const before = JSON.stringify(messages);

      repairMessages(messages);

      expect(JSON.stringify(messages)).toBe(before);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 健壮性：自愈代码本身绝不能把插件搞崩
  // ────────────────────────────────────────────────────────────
  describe('健壮性', () => {
    it('传入非数组不抛异常', () => {
      expect(() => repairMessages(null as any)).not.toThrow();
      expect(() => repairMessages(undefined as any)).not.toThrow();
      expect(() => repairMessages({} as any)).not.toThrow();
    });

    it('消息里带 null / 残缺对象不抛异常', () => {
      const messages = [null, { role: 'user' }, undefined, { role: 'tool' }, { role: 'assistant' }];
      expect(() => repairMessages(messages)).not.toThrow();
      // 修复后必须协议合法（无 id 的 tool 会被丢弃，剩下的都是合法消息）
      expect(validateMessages(repairMessages(messages).messages)).toBeNull();
    });

    it('空数组原样返回', () => {
      const result = repairMessages([]);
      expect(result.messages).toEqual([]);
      expect(result.changed).toBe(false);
    });

    it('同一 tool_call_id 有两条响应时，validate 能报出来', () => {
      const a = turn('dup');
      const messages = [a.assistant, a.tool, { ...a.tool }];
      // repair 会去重，validate 应该在修复前报错
      expect(validateMessages(messages)).toContain('多条响应');
      expect(validateMessages(repairMessages(messages).messages)).toBeNull();
    });
  });
});