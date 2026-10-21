/**
 * WriteFileTool 测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { WriteFileTool } from '../../agent/tools/writeFile';

describe('WriteFileTool', () => {
  let tmpDir: string;
  let tool: WriteFileTool;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-coder-test-'));
    tool = new WriteFileTool();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('写新文件', async () => {
    const filePath = path.join(tmpDir, 'new.txt');
    const result = await tool.execute({ path: filePath, content: '新内容' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/已写入/);
    // 验证真的写到磁盘了
    const onDisk = await fs.readFile(filePath, 'utf-8');
    expect(onDisk).toBe('新内容');
  });

  it('覆盖已有文件', async () => {
    const filePath = path.join(tmpDir, 'existing.txt');
    await fs.writeFile(filePath, 'old content', 'utf-8');

    const result = await tool.execute({ path: filePath, content: 'new content' });
    expect(result.isError).toBeFalsy();

    const onDisk = await fs.readFile(filePath, 'utf-8');
    expect(onDisk).toBe('new content');
  });

  it('自动创建父目录', async () => {
    // 类比：路径里有不存在的目录，应该自动建
    const filePath = path.join(tmpDir, 'a/b/c/deep.txt');
    const result = await tool.execute({ path: filePath, content: 'deep' });

    expect(result.isError).toBeFalsy();
    const onDisk = await fs.readFile(filePath, 'utf-8');
    expect(onDisk).toBe('deep');
  });
});
