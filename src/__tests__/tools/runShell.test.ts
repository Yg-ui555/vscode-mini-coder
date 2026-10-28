/**
 * RunShellTool 测试
 *
 * 注意：跨平台测试（Windows 用 cmd.exe，Unix 用 bash）
 */

import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';
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
    //   （用系统目录当 working_dir 就等于给了它跳出沙箱的路）
    //
    // ⚠️ 必须用【当前平台上真实存在】的越界目录（2026-10-28 修 CI 红）：
    //   原来这里写死 'C:/Windows'。可是在 Linux 上
    //   path.isAbsolute('C:/Windows') 是 false —— 它会被当成【相对路径】
    //   解析进工作区里，白名单反而放行了，最后炸在 spawn ENOENT 上
    //   （因为 <工作区>/C:/Windows 这个目录根本不存在）。
    //   于是测的就不是"白名单拦不拦"，而是"目录存不存在"。
    //
    //   现在按平台挑一个【确实存在】的系统目录，两个平台上都满足
    //   "绝对路径 + 确实在工作区外"，测的才是白名单本身。
    //
    //   为什么强调"确实存在"：
    //   万一白名单哪天坏了，白名单放行 → 命令在系统目录里真的跑起来
    //   → 测试【红】。如果那个目录压根不存在，spawn 会报 ENOENT，
    //   结果照样是 isError → 测试【假通过】，等于白测。
    const systemDir = process.platform === 'win32' ? 'C:\\Windows' : '/etc';

    const result = await tool.execute({
      command: 'echo hi',
      working_dir: systemDir,
    });
    expect(result.isError).toBeTruthy();
    expect(result.content).toContain('超出了工作区范围');
  });

  it('越界目录必须既绝对又在工作区外（守住上面那条测试的前提）', () => {
    const systemDir = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
    const resolved = path.resolve(systemDir);

    // 绝对路径 —— 否则会被当成相对路径解析进工作区（这正是 CI 红过的坑）
    expect(path.isAbsolute(resolved)).toBe(true);
    // 确实在工作区外 —— 测试里的工作区根是 os.tmpdir()
    expect(path.relative(os.tmpdir(), resolved).startsWith('..')).toBe(true);
  });
});
