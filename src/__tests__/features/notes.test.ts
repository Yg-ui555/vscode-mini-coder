/**
 * 错题本（notes）测试
 *
 * 重点验证 rewrite 后的核心承诺：
 * 记录里必须真的有【改动原因】和【踩坑】，而不只是时间路径。
 * 这是 PROJECT.md 里写了但旧实现完全没做到的事。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { appendNoteEntry, NoteEntry } from '../../util/notesStore';
import { RecordNoteTool } from '../../agent/tools/recordNote';
import { setWorkspaceRoot } from '../../agent/tools/paths';
// vitest.config.mts 已把 'vscode' 别名指到这个 stub，直接改它的 workspaceFolders 即可
import { workspace as vscodeWorkspace } from '../stubs/vscode-stub';

describe('错题本', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mini-coder-notes-'));
    setWorkspaceRoot(tmpDir);
    // notes 模块通过 vscode.workspace.workspaceFolders 拿根目录
    (vscodeWorkspace as any).workspaceFolders = [{ uri: { fsPath: tmpDir } }];
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
    (vscodeWorkspace as any).workspaceFolders = undefined;
  });

  function todayFile(): string {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return path.join(tmpDir, '.notes', `${now.getFullYear()}-${m}-${d}.md`);
  }

  // ───────────────────── 写入 ─────────────────────

  describe('appendEntry', () => {
    it('agent 富条目：改动原因和踩坑都要真的写进去', async () => {
      const entry: NoteEntry = {
        kind: 'agent',
        time: '14:30',
        title: '修 Windows 下 pytest 崩溃',
        summary: '原来用 head -50 截断输出，但 Windows cmd.exe 没有 head 命令。改成在 Node 里截断。',
        files: [{ path: 'src/features/autoTest.ts', change: '截断逻辑挪到 Node' }],
        pitfalls: ['head 是 Linux 命令，Windows 的 cmd.exe 没有，导致整条命令直接崩'],
        tests: 'pytest -q → 3 passed',
      };

      const written = await appendNoteEntry(tmpDir, entry);
      expect(written).toBeTruthy();

      const content = fs.readFileSync(todayFile(), 'utf-8');

      // ⭐ 这三项是旧实现完全没有的，也是错题本的核心价值
      expect(content).toContain('修 Windows 下 pytest 崩溃');
      expect(content).toContain('原来用 head -50');
      expect(content).toContain('head 是 Linux 命令');
      expect(content).toContain('src/features/autoTest.ts');
      expect(content).toContain('3 passed');
    });

    it('⭐ 旧实现的病根：只有时间路径的那种条目不再产生', async () => {
      await appendNoteEntry(tmpDir, {
        kind: 'watch',
        time: '14:30',
        title: '手动修改：helper.py',
        files: [{ path: 'src/helper.py', change: '手动修改' }],
      });

      const content = fs.readFileSync(todayFile(), 'utf-8');
      // 轻条目应该只占一行，且明确标注是手动修改（不冒充 agent 的总结）
      const watchLines = content.split('\n').filter((l) => l.includes('手动修改'));
      expect(watchLines.length).toBe(1);
      expect(watchLines[0].trim().startsWith('- `')).toBe(true);
      // 不应该出现二级标题——轻条目不抢戏
      expect(content).not.toMatch(/^## .*手动修改/m);
    });

    it('多次追加不会互相覆盖', async () => {
      await appendNoteEntry(tmpDir, { kind: 'agent', time: '10:00', title: '第一条' });
      await appendNoteEntry(tmpDir, { kind: 'agent', time: '11:00', title: '第二条' });

      const content = fs.readFileSync(todayFile(), 'utf-8');
      expect(content).toContain('第一条');
      expect(content).toContain('第二条');
    });

    it('首次写入会自动建文件头', async () => {
      await appendNoteEntry(tmpDir, { kind: 'agent', time: '10:00', title: 'x' });
      const content = fs.readFileSync(todayFile(), 'utf-8');
      expect(content).toContain('错题本');
    });

    it('自动生成索引页', async () => {
      await appendNoteEntry(tmpDir, { kind: 'agent', time: '10:00', title: 'x' });
      const index = path.join(tmpDir, '.notes', 'README.md');
      expect(fs.existsSync(index)).toBe(true);

      const content = fs.readFileSync(index, 'utf-8');
      // 相对链接（和索引同目录，VS Code markdown 预览能直接跳转）
      expect(content).toMatch(/\[2026-\d\d-\d\d\]\(2026-\d\d-\d\d\.md\)/);
      expect(content).toContain('1 条要点');
    });

    it('同一天不重复写索引行', async () => {
      await appendNoteEntry(tmpDir, { kind: 'agent', time: '10:00', title: 'a' });
      await appendNoteEntry(tmpDir, { kind: 'agent', time: '11:00', title: 'b' });

      const index = fs.readFileSync(path.join(tmpDir, '.notes', 'README.md'), 'utf-8');
      const lines = index.split('\n').filter((l) => l.includes('](2026-'));
      expect(lines).toHaveLength(1);
    });
  });

  // ───────────────────── record_note 工具 ─────────────────────

  describe('RecordNoteTool', () => {
    let tool: RecordNoteTool;

    beforeEach(() => {
      tool = new RecordNoteTool();
    });

    it('写入完整条目', async () => {
      await fsp.writeFile(path.join(tmpDir, 'a.ts'), 'x', 'utf-8');

      const r = await tool.execute({
        title: '定位到问题根因',
        summary: '原来判断用了 includes，退出码被丢掉了',
        files: [{ path: 'a.ts', change: '改用 exitCode' }],
        pitfalls: ['includes("passed") 在 "3 failed, 5 passed" 上会误判'],
        tests: 'vitest → 16 passed',
      });

      expect(r.isError).toBeFalsy();
      const content = fs.readFileSync(todayFile(), 'utf-8');
      expect(content).toContain('定位到问题根因');
      expect(content).toContain('includes("passed")');
      expect(content).toContain('a.ts');
      expect(content).toContain('16 passed');
    });

    it('缺 title → 明确报错', async () => {
      const r = await tool.execute({ title: '' } as any);
      expect(r.isError).toBe(true);
      expect(r.content).toContain('title');
    });

    it('files 里路径越界 → 拒绝', async () => {
      const r = await tool.execute({
        title: 'x',
        files: [{ path: '../../../etc/passwd', change: 'y' }],
      });
      expect(r.isError).toBe(true);
      expect(r.content).toMatch(/越界/);
    });

    it('是只读工具（写 .notes 而非用户代码，自动放行）', () => {
      expect(tool.meta?.readOnly).toBe(true);
      expect(tool.meta?.destructive).toBe(false);
    });

    it('工具描述里说明了什么时候【不该】记', () => {
      expect(tool.description).toContain('不要记');
      expect(tool.description).toContain('pitfalls');
    });
  });
});
