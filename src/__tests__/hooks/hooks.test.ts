/**
 * Hook 机制测试
 *
 * ⭐ 测的不只是"函数能不能用"，更重要的是【行为对不对】：
 *
 *   · hook 退出非 0 → 真的能拦住 agent（而不是只是记录一下）
 *   · hook 自己挂了 → 一定【不能】拦住 agent（否则用户配错一个脚本
 *     就把 agent 弄死了，这比没有 hook 糟糕一百倍）
 *   · Stop 连续拦截有上限 → 不会无限烧钱
 *
 * 用 MockProvider + 真实的子进程（不 mock 子进程 ——
 * 子进程的行为正是这套机制最需要被真实验证的部分）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { AgentLoop } from '../../agent/loop';
import { ToolRegistry } from '../../agent/tools/registry';
import { MockProvider, MockTool } from '../mockProvider';
import { setWorkspaceRoot } from '../../agent/tools/paths';
import { resetHookManager, getHookManager, setBuiltinStopCheck } from '../../agent/hooks/manager';
import { loadHooksConfig, entryMatches, hookConfigPaths } from '../../agent/hooks/config';
import { runHookCommand } from '../../agent/hooks/runner';

let tmp: string;

/** 写一个脚本文件，返回可以直接当命令用的字符串 */
function script(name: string, body: string): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, body, 'utf-8');
  return `node "${p}"`;
}

/** 写一个 hooks.json */
function writeHooks(obj: any): void {
  const dir = path.join(tmp, '.vscode');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mini-coder-hooks.json'), JSON.stringify(obj), 'utf-8');
  resetHookManager(); // 让单例重新读配置
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hooktest-'));
  setWorkspaceRoot(tmp);
  resetHookManager();
  setBuiltinStopCheck(undefined);
});

afterEach(() => {
  resetHookManager();
  setBuiltinStopCheck(undefined);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* 清理失败不致命 */
  }
});

// ═══════════════════════ 配置加载 ═══════════════════════

describe('Hook 配置加载', () => {
  it('没有配置文件时返回空配置（不是错误）', () => {
    const loaded = loadHooksConfig(tmp);
    expect(loaded.path).toBeNull();
    expect(loaded.config.hooks).toBeUndefined();
    expect(loaded.problems.length).toBe(0);
  });

  it('⭐ 合法配置能正确解析出事件点', () => {
    writeHooks({
      hooks: {
        PreToolUse: [{ matcher: 'write_file', hooks: [{ type: 'command', command: 'echo hi' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'npm test' }] }],
      },
    });

    const loaded = loadHooksConfig(tmp);
    expect(loaded.path).toBe(hookConfigPaths(tmp)[0]);
    expect(loaded.config.hooks?.PreToolUse?.length).toBe(1);
    expect(loaded.config.hooks?.Stop?.[0].hooks[0].command).toBe('npm test');
    expect(loaded.problems.length).toBe(0);
  });

  it('⭐ 非法 JSON 只记问题，不抛异常（用户配错了不能让 agent 起不来）', () => {
    const dir = path.join(tmp, '.vscode');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mini-coder-hooks.json'), '{ this is not json', 'utf-8');
    resetHookManager();

    const loaded = loadHooksConfig(tmp);
    expect(loaded.problems.length).toBeGreaterThan(0);
    expect(loaded.config.hooks).toBeUndefined();
  });

  it('⭐ 坏正则 matcher 不匹配任何东西，也不崩', () => {
    const entry = { matcher: '([unclosed', hooks: [{ type: 'command' as const, command: 'x' }] };
    expect(entryMatches(entry, 'anything')).toBe(false);
  });

  it('没写 matcher = 匹配全部', () => {
    const entry = { hooks: [{ type: 'command' as const, command: 'x' }] };
    expect(entryMatches(entry, 'whatever')).toBe(true);
  });

  it('matcher 是正则，不是字符串相等', () => {
    const entry = {
      matcher: 'write_file|apply_patch',
      hooks: [{ type: 'command' as const, command: 'x' }],
    };
    expect(entryMatches(entry, 'write_file')).toBe(true);
    expect(entryMatches(entry, 'apply_patch')).toBe(true);
    expect(entryMatches(entry, 'read_file')).toBe(false);
  });
});

// ═══════════════════════ 执行器 ═══════════════════════

describe('Hook 执行器', () => {
  it('⭐ 命令跑起来了，退出码 0', async () => {
    const cmd = script('ok.js', 'process.stdout.write("done"); process.exit(0);');
    const r = await runHookCommand(cmd, tmp, { hello: 'world' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('done');
    expect(r.notFound).toBe(false);
  });

  it('⭐ 命令跑起来了，退出码非 0', async () => {
    const cmd = script('fail.js', 'process.stdout.write("boom"); process.exit(3);');
    const r = await runHookCommand(cmd, tmp, {});
    expect(r.exitCode).toBe(3);
    expect(r.stdout).toContain('boom');
  });

  it('⭐⭐ 命令不存在 → notFound（跟"跑失败了"是两回事）', async () => {
    const r = await runHookCommand('definitely-not-a-real-command-xyz', tmp, {});
    expect(r.notFound).toBe(true);
    expect(r.timedOut).toBe(false);
  });

  it('⭐ 超时被杀掉', async () => {
    const cmd = script('slow.js', 'setTimeout(() => {}, 10000);');
    const r = await runHookCommand(cmd, tmp, {}, 300);
    expect(r.timedOut).toBe(true);
  });

  it('⭐ stdin 能收到 JSON 上下文', async () => {
    const cmd = script(
      'echo-stdin.js',
      'let s="";process.stdin.on("data",d=>s+=d);' +
        'process.stdin.on("end",()=>{process.stdout.write(s);});',
    );
    const r = await runHookCommand(cmd, tmp, { event: 'Stop', tool: 'write_file' });
    expect(JSON.parse(r.stdout).event).toBe('Stop');
    expect(JSON.parse(r.stdout).tool).toBe('write_file');
  });
});

// ═══════════════════════ 调度器 ═══════════════════════

describe('Hook 调度器', () => {
  it('⭐ PreToolUse：退出码非 0 → 阻断', async () => {
    writeHooks({
      hooks: { PreToolUse: [{ matcher: 'write_file', hooks: [{ type: 'command', command: script('f.js', 'process.exit(1);') }] }] },
    });
    const mgr = getHookManager(tmp);
    const out = await mgr.runPreToolUse('write_file', { path: 'a.ts' }, tmp);
    expect(out.blocked).toBe(true);
    expect(out.reason).toContain('PreToolUse');
  });

  it('⭐ PreToolUse：退出码 0 → 放行', async () => {
    writeHooks({
      hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: script('o.js', 'process.exit(0);') }] }] },
    });
    const mgr = getHookManager(tmp);
    const out = await mgr.runPreToolUse('write_file', {}, tmp);
    expect(out.blocked).toBe(false);
  });

  it('⭐⭐ 命令不存在 → 绝不阻断（用户还没配好脚本，不该把 agent 弄死）', async () => {
    writeHooks({
      hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'no-such-cmd-abc' }] }] },
    });
    const mgr = getHookManager(tmp);
    const out = await mgr.runPreToolUse('write_file', {}, tmp);
    expect(out.blocked).toBe(false);
    expect(out.problem).toBeTruthy();
  });

  it('⭐ matcher 不匹配的工具不触发 hook', async () => {
    writeHooks({
      hooks: { PreToolUse: [{ matcher: 'run_shell', hooks: [{ type: 'command', command: script('f.js', 'process.exit(1);') }] }] },
    });
    const mgr = getHookManager(tmp);
    const out = await mgr.runPreToolUse('write_file', {}, tmp);
    expect(out.blocked).toBe(false);
  });

  it('⭐ PostToolUse 永远不阻断（它是通知型的）', async () => {
    writeHooks({
      hooks: { PostToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: script('f.js', 'process.exit(1);') }] }] },
    });
    const mgr = getHookManager(tmp);
    const out = await mgr.runPostToolUse('write_file', {}, { content: 'ok' }, tmp);
    expect(out.blocked).toBe(false);
  });

  it('⭐ UserPromptSubmit 的输出会被收集起来（用来注入上下文）', async () => {
    writeHooks({
      hooks: { UserPromptSubmit: [{ matcher: '.*', hooks: [{ type: 'command', command: script('branch.js', 'process.stdout.write("main");') }] }] },
    });
    const mgr = getHookManager(tmp);
    const out = await mgr.runUserPromptSubmit('帮我改代码', tmp);
    expect(out.blocked).toBe(false);
    expect(out.output).toContain('main');
  });

  it('⭐⭐⭐ Stop 连续阻断超过上限后强制放行（防死循环烧钱）', async () => {
    writeHooks({
      hooks: { Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: script('f.js', 'process.exit(1);') }] }] },
    });
    const mgr = getHookManager(tmp);

    // 前 8 次应该都阻断
    for (let i = 0; i < 8; i++) {
      const out = await mgr.runStop('我做好了', tmp);
      expect(out.blocked, `第 ${i + 1} 次应该还在阻断`).toBe(true);
    }

    // 第 9 次：超过上限，强制放行
    const last = await mgr.runStop('我做好了', tmp);
    expect(last.blocked).toBe(false);
    expect(last.problem).toContain('上限');
  });

  it('⭐ resetStopBlocks 之后计数归零', async () => {
    writeHooks({
      hooks: { Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: script('f.js', 'process.exit(1);') }] }] },
    });
    const mgr = getHookManager(tmp);
    await mgr.runStop('x', tmp);
    expect(mgr.stopBlockCount).toBe(1);
    mgr.resetStopBlocks();
    expect(mgr.stopBlockCount).toBe(0);
  });

  it('⭐ 内置 Stop 检查也能阻断（autoTest 接的就是这个口子）', async () => {
    setBuiltinStopCheck(async () => ({ ok: false, message: '测试没过：3 failed' }));
    const mgr = getHookManager(tmp);
    const out = await mgr.runStop('我做完了', tmp);
    expect(out.blocked).toBe(true);
    expect(out.reason).toContain('3 failed');
  });

  it('⭐ 内置 Stop 检查自己抛异常 → 不阻断', async () => {
    setBuiltinStopCheck(async () => {
      throw new Error('内置检查挂了');
    });
    const mgr = getHookManager(tmp);
    const out = await mgr.runStop('我做完了', tmp);
    expect(out.blocked).toBe(false);
  });

  it('⭐⭐⭐ 内置 Stop 检查的连续阻断也受上限约束（不能无限打回）', async () => {
    // ⚠️ 这条测的是个真 bug：
    //   内置检查阻断时如果提前 return，就绕过了"连续阻断上限"的计数，
    //   内置 hook 就能无限打回 —— 上限形同虚设。
    setBuiltinStopCheck(async () => ({ ok: false, message: '测试没过' }));
    const mgr = getHookManager(tmp);

    for (let i = 0; i < 8; i++) {
      const out = await mgr.runStop('我做好了', tmp);
      expect(out.blocked, `第 ${i + 1} 次应该还在阻断`).toBe(true);
    }

    const last = await mgr.runStop('我做好了', tmp);
    expect(last.blocked).toBe(false);
    expect(last.problem).toContain('上限');
    expect(mgr.stopBlockCount).toBe(9); // 计数包含了强制放行的那一次
  });
});

// ═══════════════════════ 端到端（接进 AgentLoop）═══════════════════════

describe('Hook 接进 AgentLoop', () => {
  function mkRegistry() {
    const registry = new ToolRegistry();
    const tool = new MockTool('echo', [{ content: 'echo-result' }]);
    registry.register(tool);
    return { registry, tool };
  }

  const noop = { onText: () => {}, onToolCall: () => {}, onToolResult: () => {} };

  it('⭐⭐⭐ Stop hook 拦住收工 → agent 继续干，最终返回的是后面那次的答案', async () => {
    // ⚠️ 这个 hook 只拦【第一次】——
    //   如果它一直拦，agent 会被一直打回到触发上限（8 次），
    //   测的就不是"能不能拦住"而是"上限对不对"了（那个上面单独测了）。
    const marker = path.join(tmp, 'blocked-once.marker');
    const cmd = script(
      'block-once.js',
      `const fs = require('fs');\n` +
        `const p = ${JSON.stringify(marker)};\n` +
        `if (fs.existsSync(p)) { process.exit(0); }\n` +
        `fs.writeFileSync(p, '1');\n` +
        `process.stdout.write('tests failed');\n` +
        `process.exit(1);\n`,
    );

    writeHooks({
      hooks: { Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: cmd }] }] },
    });

    const provider = new MockProvider([
      { content: '我做完了' },      // 第一轮：声称做完了 → 被 hook 打回
      { content: '这次真的做完了' }, // 第二轮：hook 放行
    ]);
    const { registry } = mkRegistry();
    const loop = new AgentLoop(provider as any, registry, 10);

    const messages: any[] = [{ role: 'user', content: '干活' }];
    const result = await loop.run(messages, undefined, noop);

    expect(result).toBe('这次真的做完了');
    expect(provider.callCount).toBe(2); // ⭐ 被打回了一次，多跑了一轮

    // ⭐ 打回的理由必须【真的进了对话】，模型才知道为什么不能收工
    const feedback = messages.find((m) => m.role === 'user' && String(m.content).includes('tests failed'));
    expect(feedback).toBeTruthy();
  });

  it('⭐⭐ PreToolUse 否决 → 工具【没有】被执行，模型收到了理由', async () => {
    writeHooks({
      hooks: { PreToolUse: [{ matcher: 'echo', hooks: [{ type: 'command', command: script('f.js', 'process.stdout.write("禁止改这里"); process.exit(1);') }] }] },
    });

    const provider = new MockProvider([
      { toolCalls: [{ name: 'echo', args: { x: 1 } }] },
      { content: '好的，不改了' },
    ]);
    const { registry, tool } = mkRegistry();
    const loop = new AgentLoop(provider as any, registry, 10);

    const messages: any[] = [{ role: 'user', content: '干活' }];
    await loop.run(messages, undefined, noop);

    expect(tool.invocations.length).toBe(0); // ⭐ 工具根本没跑
    // 模型应该收到了拒绝理由
    const toolMsg = messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('禁止改这里');
    expect(toolMsg?.content).toContain('PreToolUse');
  });

  it('⭐ UserPromptSubmit 的输出被注入到上下文', async () => {
    writeHooks({
      hooks: { UserPromptSubmit: [{ matcher: '.*', hooks: [{ type: 'command', command: script('branch.js', 'process.stdout.write("branch: feature/x");') }] }] },
    });

    const provider = new MockProvider([{ content: '好的' }]);
    const { registry } = mkRegistry();
    const loop = new AgentLoop(provider as any, registry, 10);

    const messages: any[] = [{ role: 'user', content: '干活' }];
    await loop.run(messages, undefined, noop);

    const injected = messages.find((m) => String(m.content).includes('branch: feature/x'));
    expect(injected).toBeTruthy();
    // ⭐ 注入的内容必须【真的发给了 LLM】（不然就是白注入）
    const sent = JSON.stringify(provider.receivedMessages[0]);
    expect(sent).toContain('branch: feature/x');
  });

  it('⭐ 没有配置 hook 时，行为和以前一模一样（零开销、零副作用）', async () => {
    const provider = new MockProvider([
      { toolCalls: [{ name: 'echo', args: { x: 1 } }] },
      { content: '搞定' },
    ]);
    const { registry, tool } = mkRegistry();
    const loop = new AgentLoop(provider as any, registry, 10);

    const messages: any[] = [{ role: 'user', content: '干活' }];
    const result = await loop.run(messages, undefined, noop);

    expect(result).toBe('搞定');
    expect(tool.invocations.length).toBe(1);
    expect(messages.filter((m) => m.role === 'user').length).toBe(1); // 没注入任何东西
  });
});
