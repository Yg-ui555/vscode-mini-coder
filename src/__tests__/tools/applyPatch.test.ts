/**
 * ApplyPatchTool 测试 - 最复杂的 tool
 *
 * 测试重点：
 * - replace 单匹配 / 多匹配 / 没找到
 * - add 追加
 * - dry_run 不写盘
 * - 失败自动 rollback
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ApplyPatchTool } from '../../agent/tools/applyPatch';

describe('ApplyPatchTool', () => {
  let tmpDir: string;
  let tool: ApplyPatchTool;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-coder-test-'));
    tool = new ApplyPatchTool();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('replace 单匹配 → 替换成功', async () => {
    const filePath = path.join(tmpDir, 'a.txt');
    await fs.writeFile(filePath, 'hello world', 'utf-8');

    const result = await tool.execute({
      edits: [{ path: filePath, action: 'replace', old_text: 'world', new_text: 'mini-coder' }],
    });

    expect(result.isError).toBeFalsy();
    const onDisk = await fs.readFile(filePath, 'utf-8');
    // applyPatch 强制末尾加 \n（防止某些编辑器丢失末行）
    expect(onDisk).toBe('hello mini-coder\n');
  });

  it('replace 多匹配 → 报错（防歧义）', async () => {
    const filePath = path.join(tmpDir, 'a.txt');
    await fs.writeFile(filePath, 'foo bar foo', 'utf-8');

    const result = await tool.execute({
      edits: [{ path: filePath, action: 'replace', old_text: 'foo', new_text: 'baz' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/出现.*次/);
  });

  it('replace 没找到 → 报错', async () => {
    const filePath = path.join(tmpDir, 'a.txt');
    await fs.writeFile(filePath, 'hello', 'utf-8');

    const result = await tool.execute({
      edits: [{ path: filePath, action: 'replace', old_text: '不存在', new_text: 'x' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/未在.*找到/);
  });

  it('add → 追加到文件末尾', async () => {
    const filePath = path.join(tmpDir, 'a.txt');
    await fs.writeFile(filePath, '第一行\n', 'utf-8');

    const result = await tool.execute({
      edits: [{ path: filePath, action: 'add', new_text: '追加内容' }],
    });

    expect(result.isError).toBeFalsy();
    const onDisk = await fs.readFile(filePath, 'utf-8');
    // 原始以 \n 结尾，sep 是空字符串，所以是 "第一行\n追加内容\n"
    expect(onDisk).toBe('第一行\n追加内容\n');
  });

  it('dry_run=true → 不写盘，只校验', async () => {
    const filePath = path.join(tmpDir, 'a.txt');
    await fs.writeFile(filePath, 'original', 'utf-8');

    const result = await tool.execute({
      dry_run: true,
      edits: [{ path: filePath, action: 'replace', old_text: 'original', new_text: 'changed' }],
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/Dry-run/);
    // 验证：磁盘上还是 original
    const onDisk = await fs.readFile(filePath, 'utf-8');
    expect(onDisk).toBe('original');
  });

  it('多文件批量编辑 → 全部成功', async () => {
    const file1 = path.join(tmpDir, 'a.txt');
    const file2 = path.join(tmpDir, 'b.txt');
    await fs.writeFile(file1, 'aaa', 'utf-8');
    await fs.writeFile(file2, 'bbb', 'utf-8');

    const result = await tool.execute({
      edits: [
        { path: file1, action: 'replace', old_text: 'aaa', new_text: 'AAA' },
        { path: file2, action: 'replace', old_text: 'bbb', new_text: 'BBB' },
      ],
    });

    expect(result.isError).toBeFalsy();
    // applyPatch 强制末尾 \n
    expect(await fs.readFile(file1, 'utf-8')).toBe('AAA\n');
    expect(await fs.readFile(file2, 'utf-8')).toBe('BBB\n');
  });
});
