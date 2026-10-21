/**
 * 会话持久化测试
 *
 * 核心要验证的承诺只有一句：关掉 VS Code 再打开，对话还在。
 * 这个测试用「新建 store 实例」模拟「重启」—— 第二个 store 是全新的内存对象，
 * 只能从磁盘读到东西。它读到了，才算真的持久化了。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SessionStore, hashWorkspace } from '../../session/store';

describe('会话持久化', () => {
  let tmpDir: string;
  const ws = 'D:\\fake\\workspace';

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mini-coder-session-'));
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('保存后能读回同样的消息', () => {
    const store = new SessionStore(tmpDir, ws);
    const messages = [
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '帮我改个 bug' },
      { role: 'assistant', content: '好的，已修改' },
    ];

    store.save(messages);
    const loaded = store.load();

    expect(loaded.messages).toHaveLength(3);
    expect(loaded.messages[1].role).toBe('user');
    expect(loaded.messages[1].content).toBe('帮我改个 bug');
  });

  it('⭐ 模拟重启：新建 store 实例（内存是空的）仍能读到对话', () => {
    const first = new SessionStore(tmpDir, ws);
    first.save([
      { role: 'system', content: 'sys' },
      { role: 'user', content: '昨天说的那个需求' },
    ]);

    // 全新实例 = 相当于重启 VS Code 后重新创建的 store
    const afterRestart = new SessionStore(tmpDir, ws);
    const loaded = afterRestart.load();

    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[1].content).toBe('昨天说的那个需求');
    // 会话 id 也保持一致，说明 index 指针写对了
    expect(loaded.meta?.id).toBe(first.currentSessionId);
  });

  it('不同工作区互相隔离', () => {
    const a = new SessionStore(tmpDir, 'D:\\project-a');
    const b = new SessionStore(tmpDir, 'D:\\project-b');

    a.save([{ role: 'user', content: 'A 项目的内容' }]);
    b.save([{ role: 'user', content: 'B 项目的内容' }]);

    expect(a.load().messages[0].content).toBe('A 项目的内容');
    expect(b.load().messages[0].content).toBe('B 项目的内容');
    expect(hashWorkspace('D:\\project-a')).not.toBe(hashWorkspace('D:\\project-b'));
  });

  it('会话标题取第一条用户消息', () => {
    const store = new SessionStore(tmpDir, ws);
    store.save([
      { role: 'system', content: 'sys' },
      { role: 'user', content: '把 main.py 改成 async 函数' },
    ]);

    expect(store.load().meta?.title).toBe('把 main.py 改成 async 函数');
  });

  it('标题超长会截断', () => {
    const store = new SessionStore(tmpDir, ws);
    store.save([{ role: 'user', content: 'x'.repeat(200) }]);

    const title = store.load().meta!.title;
    expect(title.length).toBeLessThanOrEqual(41);
    expect(title.endsWith('…')).toBe(true);
  });

  it('startNew 开新会话后旧会话还在（可回溯）', () => {
    const store = new SessionStore(tmpDir, ws);
    store.save([{ role: 'user', content: '第一个会话' }]);
    const firstId = store.currentSessionId;

    store.startNew();
    store.save([{ role: 'user', content: '第二个会话' }]);

    expect(store.load().messages[0].content).toBe('第二个会话');

    // 切回第一个，内容还在
    expect(store.switchTo(firstId)).toBe(true);
    expect(store.load().messages[0].content).toBe('第一个会话');
  });

  it('switchTo 不存在的会话返回 false（不静默成功）', () => {
    const store = new SessionStore(tmpDir, ws);
    expect(store.switchTo('s-nonexistent')).toBe(false);
  });

  it('list 按最近更新排序', async () => {
    const store = new SessionStore(tmpDir, ws);

    store.save([{ role: 'user', content: '第一个' }]);
    await new Promise((r) => setTimeout(r, 5));
    const firstId = store.currentSessionId;

    store.startNew();
    await new Promise((r) => setTimeout(r, 5));
    store.save([{ role: 'user', content: '第二个' }]);

    const list = store.list();
    expect(list).toHaveLength(2);
    // 最新的在前
    expect(list[0].updatedAt >= list[1].updatedAt).toBe(true);
    expect(list[0].id).not.toBe(firstId);
  });

  it('tool_calls 和 tool_call_id 完整保留（重开会话后 LLM 才能继续）', () => {
    const store = new SessionStore(tmpDir, ws);
    store.save([
      { role: 'user', content: '改代码' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'apply_patch', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '已应用 1 个 edit' },
    ]);

    const loaded = store.load();
    expect(loaded.messages[1].tool_calls).toHaveLength(1);
    expect(loaded.messages[1].tool_calls[0].function.name).toBe('apply_patch');
    expect(loaded.messages[2].tool_call_id).toBe('call_1');
  });

  it('损坏的单行不影响其他行（JSONL 的容错性）', () => {
    const store = new SessionStore(tmpDir, ws);
    store.save([
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '第二条' },
    ]);

    // 手动往中间插一行坏数据
    const file = path.join(tmpDir, 'sessions', hashWorkspace(ws), `${store.currentSessionId}.jsonl`);
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    lines.splice(1, 0, '{ 这不是合法 JSON');
    fs.writeFileSync(file, lines.join('\n') + '\n', 'utf-8');

    const loaded = store.load();
    // metadata 和两条消息都还在
    expect(loaded.meta).not.toBeNull();
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0].content).toBe('第一条');
  });

  it('没有工作区时也能工作（不崩）', () => {
    const store = new SessionStore(tmpDir, '');
    store.save([{ role: 'user', content: '单文件模式' }]);
    expect(store.load().messages[0].content).toBe('单文件模式');
  });

  it('hasContent 反映当前会话是否有内容', () => {
    const store = new SessionStore(tmpDir, ws);
    expect(store.hasContent()).toBe(false);
    store.save([{ role: 'user', content: 'x' }]);
    expect(store.hasContent()).toBe(true);
  });

  it('delete 删掉当前会话后自动开新的', () => {
    const store = new SessionStore(tmpDir, ws);
    store.save([{ role: 'user', content: 'x' }]);
    const id = store.currentSessionId;

    store.delete(id);

    expect(store.currentSessionId).not.toBe(id);
    expect(store.load().messages).toHaveLength(0);
  });
});
