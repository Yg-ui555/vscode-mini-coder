/**
 * Slash command 注册中心测试
 *
 * 测试策略：
 * - parseSlashCommand / listSlashCommands 是纯逻辑，直接测
 * - handler 函数依赖 vscode.ExtensionContext，mock 成本高 → 不测（用真实 F5 验证）
 */

import { describe, it, expect } from 'vitest';
import { parseSlashCommand, listSlashCommands } from '../slashCommands/registry';

describe('parseSlashCommand', () => {
  it('should parse simple command without args', () => {
    expect(parseSlashCommand('/test')).toEqual({ name: 'test', args: [] });
  });

  it('should parse command with single arg', () => {
    expect(parseSlashCommand('/solve 1')).toEqual({ name: 'solve', args: ['1'] });
  });

  it('should parse command with multiple args', () => {
    expect(parseSlashCommand('/solve two sum easy')).toEqual({
      name: 'solve',
      args: ['two', 'sum', 'easy'],
    });
  });

  it('should lowercase command name', () => {
    expect(parseSlashCommand('/TEST')).toEqual({ name: 'test', args: [] });
    expect(parseSlashCommand('/Solve 1')).toEqual({ name: 'solve', args: ['1'] });
  });

  it('should trim whitespace', () => {
    expect(parseSlashCommand('   /test   ')).toEqual({ name: 'test', args: [] });
  });

  it('should return null for non-slash input', () => {
    expect(parseSlashCommand('test')).toBeNull();
    expect(parseSlashCommand('hello world')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
  });

  it('should return null for slash without name', () => {
    expect(parseSlashCommand('/')).toBeNull();
  });

  it('should handle args containing hyphens', () => {
    expect(parseSlashCommand('/solve two-sum')).toEqual({
      name: 'solve',
      args: ['two-sum'],
    });
  });
});

describe('listSlashCommands', () => {
  it('should return all 6 built-in commands', () => {
    const cmds = listSlashCommands();
    expect(cmds.length).toBe(6);
  });

  it('should include expected command names', () => {
    const names = listSlashCommands().map((c) => c.name);
    expect(names).toContain('test');
    expect(names).toContain('commit');
    expect(names).toContain('notes');
    expect(names).toContain('solve');
    expect(names).toContain('doctor');
    expect(names).toContain('logs');
  });

  it('should include description for each command', () => {
    const cmds = listSlashCommands();
    for (const cmd of cmds) {
      expect(cmd.description).toBeTruthy();
      expect(typeof cmd.description).toBe('string');
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });

  it('should expose argsHint for /solve', () => {
    const solve = listSlashCommands().find((c) => c.name === 'solve');
    expect(solve?.argsHint).toBe('<题号或标题>');
  });

  it('should return immutable snapshot (modifying does not affect next call)', () => {
    const cmds1 = listSlashCommands();
    cmds1[0].description = 'mutated';
    const cmds2 = listSlashCommands();
    expect(cmds2[0].description).not.toBe('mutated');
  });
});