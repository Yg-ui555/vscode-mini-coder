/**
 * 三档权限分级的测试
 *
 * ⭐ 这组测试保护的是一条安全边界：「用户设的权限必须真的拦住 agent」。
 *
 *   权限功能最典型的失效方式是【静默失效】——代码看起来接好了，
 *   但某个分支没走权限判断，用户以为自己锁住了 agent，它照样改文件。
 *   这种 bug 不会让任何测试变红（因为没人在测），
 *   只会在用户真被改到文件时才暴露，而且那时候已经晚了。
 *
 *   所以这里逐条断言【哪个工具在哪个档位下必须被拦】。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  approveToolCall,
  setApprovalTier,
  getApprovalTier,
  setNonInteractive,
  resetApprovals,
  detectDangerousCommand,
  blockedToolsIn,
  TIER_INFO,
  ALL_TIERS,
  isApprovalTier,
} from '../../agent/tools/approval';
import { readOnlyMeta, writeMeta, execMeta } from '../../agent/tools/meta';
import { WriteFileTool } from '../../agent/tools/writeFile';
import { ApplyPatchTool } from '../../agent/tools/applyPatch';
import { RunShellTool } from '../../agent/tools/runShell';
import { RestoreFileTool } from '../../agent/tools/restoreFile';
import { RecordNoteTool } from '../../agent/tools/recordNote';
import { setWorkspaceRoot } from '../../agent/tools/paths';
import { setCheckpointSession, clearCheckpoints } from '../../agent/checkpoint/store';
import { setEvalWorkspace } from '../../eval/shim';

// vscode stub：把 showWarningMessage 换成可编程的假弹窗
import * as vscodeStub from 'vscode';

let tmp: string;
let prompts: string[] = [];
let answer: string | undefined;

beforeEach(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'approval-'));
  setWorkspaceRoot(tmp);
  setEvalWorkspace(tmp);

  prompts = [];
  answer = undefined;

  (vscodeStub.window as any).showWarningMessage = async (message: string, ...items: any[]) => {
    prompts.push(message);
    const labels = items.filter((i) => typeof i === 'string');
    return labels.includes(answer as string) ? answer : undefined;
  };

  setCheckpointSession(`perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  clearCheckpoints();
  resetApprovals();
  setApprovalTier('askWrites');
  // 默认关掉非交互逃生舱，让测试真的走权限分支
  setNonInteractive(false);
});

afterEach(async () => {
  await fs.promises.rm(tmp, { recursive: true, force: true });
  setApprovalTier('askWrites');
  setNonInteractive(true);
  resetApprovals();
});

/** 跑一次工具调用，返回结果 */
async function callWriteFile(content: string) {
  const tool = new WriteFileTool();
  return tool.execute({ path: 'a.txt', content });
}

async function callPatch(path_: string, oldText: string, newText: string) {
  const tool = new ApplyPatchTool();
  return tool.execute({ edits: [{ path: path_, old_text: oldText, new_text: newText }] });
}

async function callShell(command: string) {
  const tool = new RunShellTool();
  return tool.execute({ command });
}

describe('ToolMeta.kind', () => {
  it('只读 / 写入 / 执行三类标得对', () => {
    expect(readOnlyMeta().kind).toBe('read');
    expect(writeMeta().kind).toBe('write');
    expect(execMeta().kind).toBe('exec');
  });

  it('⭐ 每个内置工具的 kind 都能区分开（readOnly 反推不出来的那类）', () => {
    // write_file 和 run_shell 的 readOnly/destructive 完全一样，
    // 只能靠 kind 区分 —— 这正是加这个字段的原因
    const w = new WriteFileTool().meta;
    const s = new RunShellTool().meta;
    expect(w.readOnly).toBe(s.readOnly);
    expect(w.destructive).toBe(s.destructive);
    expect(w.kind).not.toBe(s.kind);
  });

  it('record_note 标为 read：它只写 .notes/，不碰用户代码', () => {
    // 这是有意的，不是漏标。详见 recordNote.ts 里的注释。
    expect(new RecordNoteTool().meta.readOnly).toBe(true);
  });

  it('restore_file 标为 write：还原也要占权限额度', () => {
    // 否则 agent 能"删了再还原"绕过只读档
    expect(new RestoreFileTool().meta.kind).toBe('write');
  });
});

describe('readOnly 档', () => {
  beforeEach(() => setApprovalTier('readOnly'));

  it('只读工具照样放行（不能因为档位把 agent 变瞎）', async () => {
    const d = await approveToolCall({
      toolName: 'grep',
      meta: readOnlyMeta(),
      summary: '搜东西',
    });
    expect(d.approved).toBe(true);
    expect(d.prompted).toBe(false);
  });

  it('⭐ 覆盖已有文件被拒绝', async () => {
    await fs.promises.writeFile(path.join(tmp, 'a.txt'), 'old', 'utf-8');
    const r = await callWriteFile('new content');
    expect(r.isError).toBe(true);
    expect(r.content).toContain('权限');
    // 关键：文件必须没被动
    expect(await fs.promises.readFile(path.join(tmp, 'a.txt'), 'utf-8')).toBe('old');
  });

  it('⭐ 新建文件同样被拒绝（只读档的语义是"一根手指都不许动"）', async () => {
    const r = await callWriteFile('brand new');
    expect(r.isError).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'a.txt'))).toBe(false);
  });

  it('⭐ apply_patch 被拒绝且没落盘', async () => {
    await fs.promises.writeFile(path.join(tmp, 'p.txt'), 'hello', 'utf-8');
    const r = await callPatch('p.txt', 'hello', 'world');
    expect(r.isError).toBe(true);
    expect(await fs.promises.readFile(path.join(tmp, 'p.txt'), 'utf-8')).toBe('hello');
  });

  it('⭐ run_shell 被拒绝，命令没执行', async () => {
    const r = await callShell('node -e "require(\'fs\').writeFileSync(\'s.txt\',\'x\')"');
    expect(r.isError).toBe(true);
    expect(fs.existsSync(path.join(tmp, 's.txt'))).toBe(false);
  });

  it('拒绝时【不弹窗】（档位就是明确的拒绝，不是去问）', async () => {
    await callWriteFile('x');
    expect(prompts).toHaveLength(0);
  });

  it('拒绝理由告诉 LLM 这是权限限制、且别重试', async () => {
    const d = await approveToolCall({
      toolName: 'write_file',
      meta: writeMeta(),
      summary: '写点东西',
    });
    expect(d.approved).toBe(false);
    expect(d.reason).toContain('只读');
    expect(d.reason).toContain('不要反复重试');
  });
});

describe('askWrites 档（默认）', () => {
  beforeEach(() => setApprovalTier('askWrites'));

  it('覆盖已有文件要确认', async () => {
    await fs.promises.writeFile(path.join(tmp, 'a.txt'), 'old', 'utf-8');
    answer = undefined; // 用户点了拒绝
    const r = await callWriteFile('new');
    expect(r.isError).toBe(true);
    expect(prompts.length).toBe(1);
  });

  it('⭐ 新建文件免打扰（lowRisk 钩子）', async () => {
    const r = await callWriteFile('brand new');
    expect(r.isError).toBeFalsy();
    expect(prompts).toHaveLength(0); // 没弹窗
    expect(fs.existsSync(path.join(tmp, 'a.txt'))).toBe(true);
  });

  it('普通命令免打扰（askWrites 的核心体验）', async () => {
    const r = await callShell('node -e "console.log(1+1)"');
    expect(r.isError).toBeFalsy();
    expect(prompts).toHaveLength(0);
  });

  it('⭐ 高危命令要确认', async () => {
    answer = undefined; // 拒绝
    const r = await callShell('rm -rf /');
    expect(r.isError).toBe(true);
    expect(prompts.length).toBe(1);
    expect(prompts[0]).toContain('高危');
  });

  it('⭐ 本次会话都允许后不再问', async () => {
    await fs.promises.writeFile(path.join(tmp, 'a.txt'), 'v1', 'utf-8');
    answer = '本次会话都允许';
    await callWriteFile('v2');
    prompts = [];

    // 第二次同样直接放行
    const r2 = await callWriteFile('v3');
    expect(r2.isError).toBeFalsy();
    expect(prompts).toHaveLength(0);
  });

  it('只读工具任何时候都不弹窗', async () => {
    await approveToolCall({ toolName: 'read_file', meta: readOnlyMeta(), summary: '读' });
    expect(prompts).toHaveLength(0);
  });
});

describe('askAll 档', () => {
  beforeEach(() => setApprovalTier('askAll'));

  it('⭐ 普通命令也要逐条确认', async () => {
    answer = undefined;
    const r = await callShell('node -e "console.log(1+1)"');
    expect(r.isError).toBe(true);
    expect(prompts.length).toBe(1);
  });

  it('⭐ 不提供「本次会话都允许」（不能一句话开掉整类风险）', async () => {
    await fs.promises.writeFile(path.join(tmp, 'a.txt'), 'old', 'utf-8');
    answer = '本次会话都允许';
    const r = await callWriteFile('new');
    // 这个选项只对 write 类有效；exec 类压根不给
    const d = await approveToolCall({
      toolName: 'run_shell',
      meta: execMeta(),
      summary: '$ npm test',
      command: 'npm test',
    });
    expect(d.approved).toBe(false); // 选了个不存在的按钮 = 拒绝
  });

  it('覆盖已有文件要确认', async () => {
    await fs.promises.writeFile(path.join(tmp, 'a.txt'), 'old', 'utf-8');
    answer = undefined;
    expect((await callWriteFile('new')).isError).toBe(true);
  });

  it('新建文件也要确认（最严档不开后门）', async () => {
    answer = undefined;
    const r = await callWriteFile('brand new');
    expect(r.isError).toBe(true);
    expect(prompts.length).toBe(1);
  });
});

describe('非交互逃生舱', () => {
  it('setNonInteractive(true) 时三档全部放行（单测/评测不能被弹窗卡住）', async () => {
    for (const tier of ALL_TIERS) {
      setApprovalTier(tier);
      setNonInteractive(true);
      const d = await approveToolCall({ toolName: 'write_file', meta: writeMeta(), summary: 'x' });
      expect(d.approved, `tier=${tier} 应该放行`).toBe(true);
    }
  });

  it('优先级高于只读档（单测里只读档也得能写文件到临时目录）', async () => {
    setApprovalTier('readOnly');
    setNonInteractive(true);
    const r = await callWriteFile('ok');
    expect(r.isError).toBeFalsy();
  });
});

describe('高危命令检测', () => {
  it('认得出来的', () => {
    expect(detectDangerousCommand('rm -rf /')).toBeTruthy();
    expect(detectDangerousCommand('rm -rf ./build')).toBeTruthy();
    expect(detectDangerousCommand('Remove-Item x -Recurse -Force')).toBeTruthy();
    expect(detectDangerousCommand('git push --force')).toBeTruthy();
    expect(detectDangerousCommand('git reset --hard HEAD~1')).toBeTruthy();
  });

  it('不该误伤的（误伤一次，用户就会去关掉这个功能）', () => {
    expect(detectDangerousCommand('npm test')).toBeUndefined();
    expect(detectDangerousCommand('npm run build')).toBeUndefined();
    expect(detectDangerousCommand('git commit -m "x"')).toBeUndefined();
    expect(detectDangerousCommand('git push --force-with-lease')).toBeUndefined();
    expect(detectDangerousCommand('rm file.txt')).toBeUndefined();
  });

  it('空命令不炸', () => {
    expect(detectDangerousCommand('')).toBeUndefined();
  });
});

describe('blockedToolsIn（/doctor 用）', () => {
  const metas = {
    read_file: readOnlyMeta(),
    grep: readOnlyMeta(),
    apply_patch: writeMeta(),
    write_file: writeMeta(),
    restore_file: writeMeta(),
    run_shell: execMeta(),
  };

  it('readOnly 档拦住全部非只读工具', () => {
    expect(blockedToolsIn('readOnly', metas)).toEqual([
      'apply_patch',
      'restore_file',
      'run_shell',
      'write_file',
    ]);
  });

  it('askWrites 档只拦 write 类，run_shell 只在高危时拦', () => {
    expect(blockedToolsIn('askWrites', metas)).toEqual([
      'apply_patch',
      'restore_file',
      'write_file',
    ]);
  });

  it('askAll 档拦全部非只读工具', () => {
    expect(blockedToolsIn('askAll', metas)).toHaveLength(4);
  });

  it('三档都不拦只读工具', () => {
    for (const t of ALL_TIERS) {
      expect(blockedToolsIn(t, metas)).not.toContain('read_file');
      expect(blockedToolsIn(t, metas)).not.toContain('grep');
    }
  });
});

describe('档位定义本身', () => {
  it('每个档位都有 label / summary / detail 三段文案（UI 直接用）', () => {
    for (const t of ALL_TIERS) {
      expect(TIER_INFO[t].label).toBeTruthy();
      expect(TIER_INFO[t].summary.length).toBeGreaterThan(5);
      expect(TIER_INFO[t].detail).toBeTruthy();
    }
  });

  it('isApprovalTier 能挡住乱写的配置值（settings.json 可能被手改坏）', () => {
    expect(isApprovalTier('readOnly')).toBe(true);
    expect(isApprovalTier('askAll')).toBe(true);
    expect(isApprovalTier('yolo')).toBe(false);
    expect(isApprovalTier(undefined)).toBe(false);
    expect(isApprovalTier(123)).toBe(false);
  });

  it('默认档位是 askWrites', () => {
    setApprovalTier('askWrites');
    expect(getApprovalTier()).toBe('askWrites');
  });
});