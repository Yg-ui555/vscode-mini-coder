/**
 * Checkpoint 测试 —— 「AI 改错了能退回来」这个卖点的地基
 *
 * 如果这里挂了，整个差异化功能就是空的，所以必须测得实一点：
 * 不是测"函数返回了 true"，而是测"文件真的回到了原样"。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { setWorkspaceRoot } from '../../agent/tools/paths';
import { setApprovalMode } from '../../agent/tools/approval';
import { ApplyPatchTool } from '../../agent/tools/applyPatch';
import { WriteFileTool } from '../../agent/tools/writeFile';
import { RestoreFileTool } from '../../agent/tools/restoreFile';
import {
  snapshotOperation,
  listCheckpoints,
  restoreLatest,
  restoreCheckpoint,
  discardCheckpoint,
  setCheckpointSession,
  clearCheckpoints,
  CHECKPOINT_DIR,
} from '../../agent/checkpoint/store';

describe('文件 Checkpoint', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-coder-cp-'));
    setWorkspaceRoot(tmpDir);
    setApprovalMode('auto');
    setCheckpointSession(`test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    clearCheckpoints();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ────────────────────── 存储层 ──────────────────────

  describe('存储层', () => {
    it('快照落在工作区的 .mini-coder/checkpoints 下', () => {
      const f = path.join(tmpDir, 'a.txt');
      fsSync.writeFileSync(f, '原内容', 'utf-8');

      snapshotOperation('write_file', [{ absPath: f, before: '原内容' }]);

      const dir = path.join(tmpDir, CHECKPOINT_DIR);
      expect(fsSync.existsSync(dir)).toBe(true);
      expect(listCheckpoints()).toHaveLength(1);
    });

    it('新建文件也要存快照（before=null），撤销时才能删掉', () => {
      const cpId = snapshotOperation('write_file', [
        { absPath: path.join(tmpDir, 'new.txt'), before: null },
      ]);

      expect(cpId).toBeTruthy();
      const cp = listCheckpoints()[0];
      expect(cp.files[0].existed).toBe(false);
      expect(cp.files[0].before).toBeNull();
    });

    it('seq 递增', () => {
      const f = path.join(tmpDir, 'a.txt');
      snapshotOperation('write_file', [{ absPath: f, before: 'v1' }]);
      snapshotOperation('write_file', [{ absPath: f, before: 'v2' }]);

      const seqs = listCheckpoints().map((c) => c.seq);
      expect(seqs).toEqual([2, 1]); // 倒序：最新在前
    });

    it('discardCheckpoint 能删掉快照', () => {
      const id = snapshotOperation('write_file', [
        { absPath: path.join(tmpDir, 'a.txt'), before: 'x' },
      ])!;
      expect(listCheckpoints()).toHaveLength(1);

      discardCheckpoint(id);
      expect(listCheckpoints()).toHaveLength(0);
    });
  });

  // ────────────────────── 还原 ──────────────────────

  describe('还原', () => {
    it('还原已存在的文件 → 内容回到原样', async () => {
      const f = path.join(tmpDir, 'a.txt');
      fsSync.writeFileSync(f, '原始内容', 'utf-8');

      const id = snapshotOperation('write_file', [{ absPath: f, before: '原始内容' }])!;
      fsSync.writeFileSync(f, '被 AI 改坏了', 'utf-8');

      const r = restoreCheckpoint(id);

      expect(r.ok).toBe(true);
      expect(fsSync.readFileSync(f, 'utf-8')).toBe('原始内容');
    });

    it('还原新建的文件 → 文件被删除', async () => {
      const f = path.join(tmpDir, 'junk.txt');

      const id = snapshotOperation('write_file', [{ absPath: f, before: null }])!;
      fsSync.writeFileSync(f, 'AI 建的一堆垃圾', 'utf-8');
      expect(fsSync.existsSync(f)).toBe(true);

      const r = restoreCheckpoint(id);

      expect(r.ok).toBe(true);
      expect(fsSync.existsSync(f)).toBe(false);
    });

    it('⭐ 一次改多个文件 → 一次还原全退回（不用点 N 次）', async () => {
      const a = path.join(tmpDir, 'a.ts');
      const b = path.join(tmpDir, 'sub', 'b.ts');
      const c = path.join(tmpDir, 'c.ts');
      fsSync.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
      fsSync.writeFileSync(a, 'A原', 'utf-8');
      fsSync.writeFileSync(b, 'B原', 'utf-8');
      fsSync.writeFileSync(c, 'C原', 'utf-8');

      const id = snapshotOperation('apply_patch', [
        { absPath: a, before: 'A原' },
        { absPath: b, before: 'B原' },
        { absPath: c, before: 'C原' },
      ])!;

      fsSync.writeFileSync(a, 'A改', 'utf-8');
      fsSync.writeFileSync(b, 'B改', 'utf-8');
      fsSync.writeFileSync(c, 'C改', 'utf-8');

      const r = restoreCheckpoint(id);

      expect(r.ok).toBe(true);
      expect(r.restoredFiles).toHaveLength(3);
      expect(fsSync.readFileSync(a, 'utf-8')).toBe('A原');
      expect(fsSync.readFileSync(b, 'utf-8')).toBe('B原');
      expect(fsSync.readFileSync(c, 'utf-8')).toBe('C原');
    });

    it('restoreLatest 退回最近一次，且按时间倒序', () => {
      const f = path.join(tmpDir, 'a.txt');
      snapshotOperation('write_file', [{ absPath: f, before: 'v1' }]);
      snapshotOperation('write_file', [{ absPath: f, before: 'v2' }]);
      fsSync.writeFileSync(f, 'v3', 'utf-8');

      const { result } = restoreLatest();

      expect(result.ok).toBe(true);
      expect(fsSync.readFileSync(f, 'utf-8')).toBe('v2');
    });

    it('已还原过的不能重复还原（否则会覆盖用户之后的修改）', () => {
      const f = path.join(tmpDir, 'a.txt');
      const id = snapshotOperation('write_file', [{ absPath: f, before: '原' }])!;

      restoreCheckpoint(id);
      // 用户之后又自己改了一遍
      fsSync.writeFileSync(f, '用户手改的', 'utf-8');

      const second = restoreCheckpoint(id);

      expect(second.ok).toBe(false);
      expect(second.message).toMatch(/已经还原过/);
      // 用户的手改必须还在
      expect(fsSync.readFileSync(f, 'utf-8')).toBe('用户手改的');
    });

    it('没有可还原的 → 明确说明', () => {
      const { result } = restoreLatest();
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/没有可还原的修改记录/);
    });
  });

  // ────────────────────── 与工具打通 ──────────────────────

  describe('与写工具打通', () => {
    it('apply_patch 改完自动产生可还原的快照', async () => {
      const f = path.join(tmpDir, 'a.ts');
      fsSync.writeFileSync(f, 'const a = 1;\n', 'utf-8');

      const tool = new ApplyPatchTool();
      const result = await tool.execute({
        edits: [{ path: 'a.ts', action: 'replace', old_text: 'const a = 1;', new_text: 'const a = 2;' }],
      });

      expect(result.isError).toBeFalsy();
      expect(fsSync.readFileSync(f, 'utf-8')).toMatch(/const a = 2;/);
      expect(result.content).toMatch(/已存档/);

      // 退回
      const { result: undo } = restoreLatest();
      expect(undo.ok).toBe(true);
      expect(fsSync.readFileSync(f, 'utf-8')).toMatch(/const a = 1;/);
    });

    it('write_file 新建文件也会留快照（撤销时删掉）', async () => {
      const tool = new WriteFileTool();
      const result = await tool.execute({ path: 'new.txt', content: 'AI 写的' });

      expect(result.isError).toBeFalsy();
      expect(fsSync.existsSync(path.join(tmpDir, 'new.txt'))).toBe(true);

      const { result: undo } = restoreLatest();
      expect(undo.ok).toBe(true);
      expect(fsSync.existsSync(path.join(tmpDir, 'new.txt'))).toBe(false);
    });

    it('dry_run 不产生快照（没真改就不该占 undo 历史）', async () => {
      const f = path.join(tmpDir, 'a.ts');
      fsSync.writeFileSync(f, 'const a = 1;\n', 'utf-8');

      const tool = new ApplyPatchTool();
      await tool.execute({
        edits: [{ path: 'a.ts', action: 'replace', old_text: 'const a = 1;', new_text: 'const a = 9;' }],
        dry_run: true,
      });

      expect(listCheckpoints()).toHaveLength(0);
      expect(fsSync.readFileSync(f, 'utf-8')).toMatch(/const a = 1;/);
    });
  });

  // ────────────────────── restore_file 工具 ──────────────────────

  describe('RestoreFileTool', () => {
    it('按路径还原该文件最近一次修改', async () => {
      const f = path.join(tmpDir, 'a.ts');
      fsSync.writeFileSync(f, 'v1', 'utf-8');
      snapshotOperation('apply_patch', [{ absPath: f, before: 'v1' }]);
      fsSync.writeFileSync(f, 'v2', 'utf-8');

      const tool = new RestoreFileTool();
      const result = await tool.execute({ path: 'a.ts' });

      expect(result.isError).toBeFalsy();
      expect(fsSync.readFileSync(f, 'utf-8')).toBe('v1');
    });

    it('该文件没有记录时 → 明确报错并提示怎么办', async () => {
      fsSync.writeFileSync(path.join(tmpDir, 'a.ts'), 'x', 'utf-8');

      const tool = new RestoreFileTool();
      const result = await tool.execute({ path: 'a.ts' });

      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/找不到/);
      // 错误提示必须带"换个做法"的引导，否则 LLM 会原地重试
      expect(result.content).toMatch(/换一个做法|read_file/);
    });

    it('路径越界被拦截', async () => {
      const tool = new RestoreFileTool();
      const result = await tool.execute({ path: '../../../Windows/System32/config' });

      expect(result.isError).toBe(true);
    });

    it('是破坏性工具（必须经过确认 + 存档）', () => {
      expect(new RestoreFileTool().meta?.destructive).toBe(true);
      expect(new RestoreFileTool().meta?.readOnly).toBe(false);
    });
  });
});
