/**
 * applyPatch 工具测试
 *
 * 为什么重点测这个：
 * - 杀手特性，整个扩展的灵魂（结构化编辑 + rollback）
 * - 边界情况多（rollback / 多 hunk / 大小写 / 不匹配 / dry_run）
 * - 错误处理路径必须覆盖（一旦失败回滚错了就是数据丢失）
 *
 * 测试策略：用 os.tmpdir() 隔离临时目录，每个 case 用 unique dir
 */

/**
 * applyPatch 工具测试
 *
 * 为什么重点测这个：
 * - 杀手特性，整个扩展的灵魂（结构化编辑 + rollback）
 * - 边界情况多（rollback / 多 hunk / 大小写 / 不匹配 / dry_run）
 * - 错误处理路径必须覆盖（一旦失败回滚错了就是数据丢失）
 *
 * 测试策略：用 os.tmpdir() 隔离临时目录，每个 case 用 unique dir
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ApplyPatchTool } from '../agent/tools/applyPatch';

let tmpDir: string;

beforeEach(async () => {
  // 每个 case 一个独立临时目录，避免互相污染
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-coder-test-'));
});

afterEach(async () => {
  // 清理
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ApplyPatchTool', () => {
  it('should replace unique old_text with new_text', async () => {
    const file = path.join(tmpDir, 'a.txt');
    await fs.writeFile(file, 'hello world\n', 'utf-8');

    const tool = new ApplyPatchTool();
    const result = await tool.execute({
      edits: [{ path: file, action: 'replace', old_text: 'hello', new_text: 'hi' }],
    });

    expect(result.isError).toBeFalsy();
    expect(await fs.readFile(file, 'utf-8')).toBe('hi world\n');
  });

  it('should reject when old_text is not found', async () => {
    const file = path.join(tmpDir, 'a.txt');
    await fs.writeFile(file, 'hello world\n', 'utf-8');

    const tool = new ApplyPatchTool();
    const result = await tool.execute({
      edits: [{ path: file, action: 'replace', old_text: 'NOTHERE', new_text: 'X' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/未在/);
  });

  it('should reject when old_text appears multiple times (ambiguous)', async () => {
    const file = path.join(tmpDir, 'a.txt');
    await fs.writeFile(file, 'foo bar foo\n', 'utf-8');

    const tool = new ApplyPatchTool();
    const result = await tool.execute({
      edits: [{ path: file, action: 'replace', old_text: 'foo', new_text: 'baz' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/出现 2 次/);
  });

  it('should support action=add (append to end)', async () => {
    const file = path.join(tmpDir, 'a.txt');
    await fs.writeFile(file, 'line1\n', 'utf-8');

    const tool = new ApplyPatchTool();
    const result = await tool.execute({
      edits: [{ path: file, action: 'add', new_text: 'line2' }],
    });

    expect(result.isError).toBeFalsy();
    expect(await fs.readFile(file, 'utf-8')).toBe('line1\nline2\n');
  });

  it('should add with newline separator when file has no trailing newline', async () => {
    const file = path.join(tmpDir, 'a.txt');
    await fs.writeFile(file, 'line1', 'utf-8');

    const tool = new ApplyPatchTool();
    const result = await tool.execute({
      edits: [{ path: file, action: 'add', new_text: 'line2' }],
    });

    expect(result.isError).toBeFalsy();
    expect(await fs.readFile(file, 'utf-8')).toBe('line1\nline2\n');
  });

  it('should support dry_run (no write)', async () => {
    const file = path.join(tmpDir, 'a.txt');
    const original = 'hello\n';
    await fs.writeFile(file, original, 'utf-8');

    const tool = new ApplyPatchTool();
    const result = await tool.execute({
      edits: [{ path: file, action: 'replace', old_text: 'hello', new_text: 'hi' }],
      dry_run: true,
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/Dry-run OK/);
    // 文件内容没变
    expect(await fs.readFile(file, 'utf-8')).toBe(original);
  });

  it('should rollback when write fails (mock fs.writeFile)', async () => {
    // ESM 模式下 vi.spyOn(fs) 不能用，用 vi.mock 替代
    const realFs = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    const writeFileSpy = vi.fn();
    writeFileSpy.mockImplementationOnce(async () => {
      throw new Error('模拟磁盘写入失败');
    });
    // 后续 writeFile 走真实实现
    writeFileSpy.mockImplementation(realFs.writeFile);

    // 用一个独立测试 module 替换 fs.writeFile
    vi.doMock('fs/promises', async () => ({
      ...realFs,
      writeFile: writeFileSpy as any,
    }));

    // 重新 import applyPatch 以拿到新 mock
    const { ApplyPatchTool: MockedTool } = await import('../agent/tools/applyPatch?mocked');

    const fileA = path.join(tmpDir, 'a.txt');
    await realFs.writeFile(fileA, 'original A\n', 'utf-8');

    const tool = new MockedTool();
    const result = await tool.execute({
      edits: [{ path: fileA, action: 'replace', old_text: 'original', new_text: 'CHANGED' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/已回滚|失败/);
    // rollback 成功后 fileA 内容应回到原始
    expect(await realFs.readFile(fileA, 'utf-8')).toBe('original A\n');

    vi.doUnmock('fs/promises');
  });

  it('should handle multiple edits in one call (multi-file)', async () => {
    const fileA = path.join(tmpDir, 'a.txt');
    const fileB = path.join(tmpDir, 'b.txt');
    await fs.writeFile(fileA, 'AAA\n', 'utf-8');
    await fs.writeFile(fileB, 'BBB\n', 'utf-8');

    const tool = new ApplyPatchTool();
    const result = await tool.execute({
      edits: [
        { path: fileA, action: 'replace', old_text: 'AAA', new_text: 'XXX' },
        { path: fileB, action: 'replace', old_text: 'BBB', new_text: 'YYY' },
      ],
    });

    expect(result.isError).toBeFalsy();
    expect(await fs.readFile(fileA, 'utf-8')).toBe('XXX\n');
    expect(await fs.readFile(fileB, 'utf-8')).toBe('YYY\n');
  });

  it('should escape regex special characters in old_text', async () => {
    const file = path.join(tmpDir, 'a.txt');
    await fs.writeFile(file, 'function foo() { return 1; }\n', 'utf-8');

    const tool = new ApplyPatchTool();
    // old_text 含正则特殊字符 ( ) { }，如果没 escape 会 match 错位置
    const result = await tool.execute({
      edits: [
        {
          path: file,
          action: 'replace',
          old_text: 'function foo() { return 1; }',
          new_text: 'function foo() { return 2; }',
        },
      ],
    });

    expect(result.isError).toBeFalsy();
    expect(await fs.readFile(file, 'utf-8')).toBe('function foo() { return 2; }\n');
  });

  it('should reject edit missing required fields', async () => {
    const tool = new ApplyPatchTool();
    const result = await tool.execute({
      edits: [{ path: 'x.txt' } as any], // 缺 action
    });

    expect(result.isError).toBe(true);
  });
});