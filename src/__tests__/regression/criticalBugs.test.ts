/**
 * 回归测试：P0 级 bug 修复验证
 *
 * 这个文件里的每个 it() 对应一个【已经实测复现过的 bug】，
 * 防止以后改代码时不小心退回去。
 *
 * 背景：2026-10-20 的代码审查中实测发现——
 *   apply_patch 对同一文件做 3 个 edit 时，工具返回"已应用 3 个 edit"，
 *   但实际只有最后一个生效，前两个被静默丢弃。
 *   这是典型的"静默失败"：不报错、结果错、最难 debug。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { ApplyPatchTool } from '../../agent/tools/applyPatch';
import { WriteFileTool } from '../../agent/tools/writeFile';
import { ReadFileTool } from '../../agent/tools/readFile';
import { setWorkspaceRoot } from '../../agent/tools/paths';
import { setNonInteractive, resetApprovals } from '../../agent/tools/approval';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minicoder-reg-'));
  // ⭐ 必须设工作区根目录，否则路径白名单会退化成"不检查"
  setWorkspaceRoot(tmpDir);
  // 测试环境没有真实弹窗，自动放行（越界拦截仍由白名单负责）
  setNonInteractive(true);
  resetApprovals();
});

afterEach(async () => {
  // 还原成全局 setup 设的值，别污染同进程内的后续测试
  setWorkspaceRoot(os.tmpdir());
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe('P0-1: apply_patch 同一文件多个 edit 必须全部生效', () => {
  it('3 个 edit 指向同一文件时，每个都要应用（修复前只有最后一个生效）', async () => {
    const file = path.join(tmpDir, 'demo.txt');
    await fs.writeFile(file, 'alpha\nbravo\ncharlie', 'utf-8');

    const tool = new ApplyPatchTool();
    const result = await tool.execute({
      edits: [
        { path: file, action: 'replace', old_text: 'alpha', new_text: 'ALPHA' },
        { path: file, action: 'replace', old_text: 'bravo', new_text: 'BRAVO' },
        { path: file, action: 'replace', old_text: 'charlie', new_text: 'CHARLIE' },
      ],
    });

    expect(result.isError).toBeFalsy();
    const content = await fs.readFile(file, 'utf-8');

    // 核心断言：三个都要变成大写
    expect(content).toContain('ALPHA');
    expect(content).toContain('BRAVO');
    expect(content).toContain('CHARLIE');
    // 一个都不能是原来的小写
    expect(content).not.toMatch(/\balpha\b/);
    expect(content).not.toMatch(/\bbravo\b/);
  });

  it('第二个 edit 的 old_text 可以匹配第一个 edit 刚写进去的内容（链式修改）', async () => {
    const file = path.join(tmpDir, 'chain.txt');
    await fs.writeFile(file, 'version=1', 'utf-8');

    const tool = new ApplyPatchTool();
    const result = await tool.execute({
      edits: [
        { path: file, action: 'replace', old_text: 'version=1', new_text: 'version=2' },
        // 这条依赖上一条的结果：磁盘上此时还是 version=1
        { path: file, action: 'replace', old_text: 'version=2', new_text: 'version=3' },
      ],
    });

    expect(result.isError).toBeFalsy();
    const content = await fs.readFile(file, 'utf-8');
    expect(content.trim()).toBe('version=3');
  });

  it('同一文件的 replace + add 混合操作要按顺序生效', async () => {
    const file = path.join(tmpDir, 'mix.txt');
    await fs.writeFile(file, 'line1', 'utf-8');

    const tool = new ApplyPatchTool();
    const result = await tool.execute({
      edits: [
        { path: file, action: 'replace', old_text: 'line1', new_text: 'line1-fixed' },
        { path: file, action: 'add', new_text: 'line2-added' },
      ],
    });

    expect(result.isError).toBeFalsy();
    const content = await fs.readFile(file, 'utf-8');
    expect(content).toContain('line1-fixed');
    expect(content).toContain('line2-added');
  });

  it('多个文件各自独立修改，互不影响', async () => {
    const fileA = path.join(tmpDir, 'a.txt');
    const fileB = path.join(tmpDir, 'b.txt');
    await fs.writeFile(fileA, 'aaa', 'utf-8');
    await fs.writeFile(fileB, 'bbb', 'utf-8');

    const tool = new ApplyPatchTool();
    const result = await tool.execute({
      edits: [
        { path: fileA, action: 'replace', old_text: 'aaa', new_text: 'AAA' },
        { path: fileB, action: 'replace', old_text: 'bbb', new_text: 'BBB' },
      ],
    });

    expect(result.isError).toBeFalsy();
    expect(await fs.readFile(fileA, 'utf-8')).toContain('AAA');
    expect(await fs.readFile(fileB, 'utf-8')).toContain('BBB');
  });

  it('新_text 里的 $& 不会被当成正则替换符（会静默篡改用户代码）', async () => {
    const file = path.join(tmpDir, 'dollar.txt');
    await fs.writeFile(file, 'replace-me', 'utf-8');

    const tool = new ApplyPatchTool();
    // $& 在 JS replace(str, str) 里表示"整个匹配内容"，会把原文本插回去
    const result = await tool.execute({
      edits: [
        { path: file, action: 'replace', old_text: 'replace-me', new_text: 'cost is $& dollars' },
      ],
    });

    expect(result.isError).toBeFalsy();
    const content = await fs.readFile(file, 'utf-8');
    // 应该原样保留 $&，而不是变成 replace-me
    expect(content).toContain('cost is $& dollars');
    expect(content).not.toContain('cost is replace-me dollars');
  });

  it('dry_run 不写盘', async () => {
    const file = path.join(tmpDir, 'dry.txt');
    await fs.writeFile(file, 'original', 'utf-8');

    const tool = new ApplyPatchTool();
    const result = await tool.execute({
      dry_run: true,
      edits: [{ path: file, action: 'replace', old_text: 'original', new_text: 'changed' }],
    });

    expect(result.isError).toBeFalsy();
    expect(await fs.readFile(file, 'utf-8')).toBe('original');
  });
});

describe('P1-6: 路径白名单', () => {
  it('工作区外的路径被拒绝（../ 越界）', async () => {
    const tool = new ReadFileTool();
    const result = await tool.execute({ path: '../../../etc/passwd' });

    expect(result.isError).toBeTruthy();
    expect(result.content).toMatch(/超出了工作区范围|文件不存在/);
  });

  it('工作区外的绝对路径被拒绝', async () => {
    const tool = new WriteFileTool();
    // ⚠️ 必须用【当前平台上真实存在的】越界绝对路径（2026-10-28 修 CI 红）：
    //   原来写死 'C:/Windows/System32/evil.dll'。在 Linux 上
    //   path.isAbsolute('C:/Windows/...') 是 false —— 它被当成相对路径
    //   解析进了工作区，白名单【放行】，文件居然真的被写进去了。
    //   也就是说：这条断言在 Linux 上测的根本不是"越界被拦住"，
    //   而是"Windows 盘符路径在 POSIX 上不是绝对路径"这个冷知识。
    //
    //   现在按平台挑一个【确实存在】的系统目录，两个平台上都是
    //   "绝对 + 越界"，测的才是路径白名单本身。
    const systemDir = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
    const outsidePath = path.join(systemDir, 'evil.dll');

    const result = await tool.execute({
      path: outsidePath,
      content: 'malicious',
    });

    expect(result.isError).toBeTruthy();
    expect(result.content).toContain('超出了工作区范围');
  });

  it('apply_patch 也不能写工作区外', async () => {
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.txt`);
    const tool = new ApplyPatchTool();
    const result = await tool.execute({
      edits: [{ path: outside, action: 'add', new_text: 'evil' }],
    });

    expect(result.isError).toBeTruthy();
    // 确认文件真的没被创建
    await expect(fs.access(outside)).rejects.toBeTruthy();
  });

  it('工作区内的相对路径正常工作（不能误伤）', async () => {
    const nested = path.join(tmpDir, 'src', 'nested');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, 'ok.txt'), 'fine', 'utf-8');

    const tool = new ReadFileTool();
    const result = await tool.execute({ path: path.join(nested, 'ok.txt') });

    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('fine');
  });
});

describe('read_file 分段读取', () => {
  it('offset/limit 能读指定行段', async () => {
    const file = path.join(tmpDir, 'lines.txt');
    await fs.writeFile(file, ['L1', 'L2', 'L3', 'L4', 'L5'].join('\n'), 'utf-8');

    const tool = new ReadFileTool();
    const result = await tool.execute({ path: file, offset: 2, limit: 2 });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('L2');
    expect(result.content).toContain('L3');
    expect(result.content).not.toContain('L1');
    expect(result.content).not.toContain('L4');
  });
});