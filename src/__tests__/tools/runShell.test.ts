/**
 * RunShellTool 测试
 *
 * 注意：跨平台测试（Windows 用 cmd.exe，Unix 用 bash）
 */

import { describe, it, expect } from 'vitest';
import * as os from 'os';
import { RunShellTool } from '../../agent/tools/runShell';

const tool = new RunShellTool();

describe('RunShellTool', () => {
  it('执行 echo 命令（跨平台）', async () => {
    // Windows 用 cmd，Unix 用 bash —— 跨平台写法
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'echo hello' : 'echo hello';

    const result = await tool.execute({ command: cmd });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('hello');
  });

  it('命令返回非 0 → 错误信息含 exit code', async () => {
    // 类比：故意跑个不存在的命令
    const result = await tool.execute({ command: 'exit 7' });
    expect(result.content).toMatch(/exit.*7/);
  });

  it('超时（1ms 跑 sleep）→ 报错', async () => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'ping -n 2 127.0.0.1' : 'sleep 0.5';

    const result = await tool.execute({ command: cmd, timeout: 1 });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/超时/);
  });

  it('超大输出（>30000 字符）→ 自动截断', async () => {
    // 类比：命令输出太多，自动截断防上下文爆炸
    const isWin = process.platform === 'win32';
    // 生成 40000 个 a
    const cmd = isWin
      ? 'powershell -Command "Write-Output (\'a\' * 40000)"'
      : 'printf \'a%.0s\' $(seq 1 40000)';

    const result = await tool.execute({ command: cmd });
    expect(result.content.length).toBeLessThan(35_000);
  }, 10_000); // 10 秒超时

  it('working_dir 参数 → 在指定目录跑', async () => {
    // 跨平台：列出 working_dir 的内容（验证 cwd 设对了）
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cd' : 'pwd';

    // ⚠ 2026-10-20 起 working_dir 必须落在工作区内（路径白名单）。
    //   测试环境的"工作区"被 setup 设成 os.tmpdir()，
    //   所以这里用 tmpdir 而不是项目根目录。
    const tmpDir = os.tmpdir();
    const result = await tool.execute({ command: cmd, working_dir: tmpDir });
    expect(result.isError).toBeFalsy();
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('working_dir 在工作区外 → 被拒绝（路径白名单）', async () => {
    // ⭐ 安全约束：LLM 不能让命令跑在工作区之外
    //   （用 C:/Windows 当 working_dir 就等于给了它跳出沙箱的路）
    const result = await tool.execute({
      command: 'echo hi',
      working_dir: 'C:/Windows',
    });
    expect(result.isError).toBeTruthy();
    expect(result.content).toContain('超出了工作区范围');
  });
});
