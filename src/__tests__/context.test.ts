/**
 * ContextBuilder 测试 - System prompt 拼装 + 项目规则 bootstrap
 *
 * 为什么测这个：
 * - system prompt 是 agent 行为的"宪法"，写错整个产品行为就歪
 * - bootstrap 文件加载有 50KB 限制、缺失静默等边界
 * - 这是差异化特色（借鉴 nanobot 的 AGENTS.md 加载），值得专门覆盖
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ContextBuilder } from '../agent/context';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ContextBuilder', () => {
  it('should build prompt without workspaceRoot (no bootstrap)', () => {
    const prompt = new ContextBuilder(null).buildSystemPrompt();
    expect(prompt).toContain('Mini-Coder 身份');
    expect(prompt).toContain('核心约定');
    // 没 workspaceRoot → 不包含工作目录路径
    expect(prompt).not.toMatch(/工作目录：/);
  });

  it('should include workspace path in prompt', () => {
    const prompt = new ContextBuilder(tmpDir).buildSystemPrompt();
    expect(prompt).toContain(tmpDir);
  });

  it('should load AGENTS.md from workspace root', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'AGENTS.md'),
      '# 项目规则\n- 命名用 snake_case\n- 禁止用 emoji',
      'utf-8',
    );
    const prompt = new ContextBuilder(tmpDir).buildSystemPrompt();
    expect(prompt).toContain('AGENTS.md');
    expect(prompt).toContain('snake_case');
    expect(prompt).toContain('禁止用 emoji');
  });

  it('should load multiple bootstrap files in order', async () => {
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), 'PROJECT_RULES', 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'SOUL.md'), 'AGENT_SOUL', 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'USER.md'), 'USER_PREFERENCES', 'utf-8');

    const prompt = new ContextBuilder(tmpDir).buildSystemPrompt();
    expect(prompt).toContain('PROJECT_RULES');
    expect(prompt).toContain('AGENT_SOUL');
    expect(prompt).toContain('USER_PREFERENCES');

    // 顺序应该是 AGENTS → SOUL → USER
    const idxAgents = prompt.indexOf('PROJECT_RULES');
    const idxSoul = prompt.indexOf('AGENT_SOUL');
    const idxUser = prompt.indexOf('USER_PREFERENCES');
    expect(idxAgents).toBeLessThan(idxSoul);
    expect(idxSoul).toBeLessThan(idxUser);
  });

  it('should silently skip missing bootstrap files', async () => {
    // 没有任何 bootstrap 文件
    const prompt = new ContextBuilder(tmpDir).buildSystemPrompt();
    expect(prompt).toContain('Mini-Coder 身份');
    expect(prompt).not.toContain('项目规则');
  });

  it('should silently skip empty bootstrap files', async () => {
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '   \n\n  ', 'utf-8');
    const prompt = new ContextBuilder(tmpDir).buildSystemPrompt();
    expect(prompt).not.toContain('AGENTS.md');
  });

  it('should skip bootstrap files larger than 50KB', async () => {
    const hugeContent = 'x'.repeat(60_000);
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), hugeContent, 'utf-8');
    const prompt = new ContextBuilder(tmpDir).buildSystemPrompt();
    expect(prompt).not.toContain('xxx');
  });

  it('should contain Chinese commit convention', () => {
    const prompt = new ContextBuilder(null).buildSystemPrompt();
    expect(prompt).toContain('中文 commit 规范');
    expect(prompt).toContain('功能:');
    expect(prompt).toContain('修复:');
  });

  it('should mention key tools (apply_patch, run_shell)', () => {
    const prompt = new ContextBuilder(null).buildSystemPrompt();
    expect(prompt).toContain('apply_patch');
    expect(prompt).toContain('run_shell');
  });
});