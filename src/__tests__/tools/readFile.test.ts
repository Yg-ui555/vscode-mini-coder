/**
 * ReadFileTool 测试
 *
 * 测试策略：用临时目录（不污染真实项目）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ReadFileTool } from '../../agent/tools/readFile';

describe('ReadFileTool', () => {
  let tmpDir: string;
  let tool: ReadFileTool;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-coder-test-'));
    tool = new ReadFileTool();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('读存在的文件', async () => {
    const filePath = path.join(tmpDir, 'hello.txt');
    await fs.writeFile(filePath, '你好世界', 'utf-8');

    const result = await tool.execute({ path: filePath });
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('你好世界');
  });

  it('读不存在的文件 → isError: true', async () => {
    const result = await tool.execute({ path: path.join(tmpDir, 'nope.txt') });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/文件不存在/);
  });

  it('读超大文件（>30000 字符）→ 自动截断', async () => {
    const big = 'x'.repeat(50_000); // 5 万字符
    const filePath = path.join(tmpDir, 'big.txt');
    await fs.writeFile(filePath, big, 'utf-8');

    const result = await tool.execute({ path: filePath });
    expect(result.isError).toBeFalsy();
    // 截断标记应该出现
    expect(result.content).toMatch(/文件过大，已截断/);
    // 截断后长度不超过 30000 + 提示文字
    expect(result.content.length).toBeLessThan(31_000);
  });

  it('相对路径从 cwd 解析', async () => {
    // tmpDir 不是 cwd，所以这个测试验证：相对路径会找不到
    // （因为 cwd 是项目根目录，不是 tmpDir）
    const result = await tool.execute({ path: 'relative-not-exist.txt' });
    expect(result.isError).toBe(true);
  });
});
