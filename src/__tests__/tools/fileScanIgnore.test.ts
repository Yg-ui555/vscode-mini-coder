/**
 * 忽略目录规则 —— 2026-10-25 真实项目验证时补的一组守卫
 *
 * ⭐ 起因（真实踩坑，不是假想）：
 *   拿插件去审计一个真实的 Python 项目（同时存在 venv311 / venv_old
 *   两个虚拟环境），文件扫描的 20000 上限被【一个目录吃光】：
 *
 *     venv_old        19992 个文件（占 99.96%）
 *     真正的项目代码   一个都没扫到
 *
 *   而 venv_old / venv311 这种【带版本号】的目录名，
 *   原来的 IGNORED_DIRS（精确匹配）一个都拦不住。
 *
 *   后果不是「慢一点」，而是「grep 全仓」这类操作直接失效 ——
 *   agent 只能靠 glob 手动绕开，浪费轮次还容易漏文件。
 */

import { describe, it, expect } from 'vitest';
import { isIgnoredDirName, IGNORED_DIRS } from '../../agent/tools/fileScan';

describe('忽略目录规则', () => {
  it('精确匹配的老名单仍然生效', () => {
    const must = [
      'node_modules',
      '.git',
      '.svn',
      '.hg',
      'dist',
      'out',
      'build',
      '__pycache__',
      '.venv',
      'venv',
      'coverage',
      '.idea',
      '.mini-coder',
      '.notes',
    ];
    for (const d of must) {
      expect(isIgnoredDirName(d), `${d} 应该被忽略`).toBe(true);
    }
  });

  it('⭐ 带版本号的虚拟环境目录必须被忽略', () => {
    // 这几个就是真实项目里把扫描配额吃光的元凶
    for (const d of ['venv311', 'venv_old', 'venv3.11', 'venv2', '.venv311', '.venv3']) {
      expect(isIgnoredDirName(d), `${d} 应该被忽略`).toBe(true);
    }
  });

  it('其他常见的第三方 / 构建目录', () => {
    for (const d of ['site-packages', '__pypackages__', 'eggs', '.tox', '.nox', 'target', 'vendor']) {
      expect(isIgnoredDirName(d), `${d} 应该被忽略`).toBe(true);
    }
  });

  it('⭐ 不能误伤正常的项目目录', () => {
    // 这些是真实存在的项目目录名，被忽略就等于"看不见用户的代码"
    for (const d of [
      'src',
      'tests',
      'docs',
      'data',
      'config',
      'app',
      'environment', // 长得像 venv 但不是 venv
      'envs',
      'targets',
      'vendored',
    ]) {
      expect(isIgnoredDirName(d), `${d} 不该被忽略`).toBe(false);
    }
  });

  it('IGNORED_DIRS 导出仍然保留（兼容性：外部按精确名单消费它）', () => {
    expect(IGNORED_DIRS.has('node_modules')).toBe(true);
    expect(IGNORED_DIRS.has('venv311')).toBe(false); // 它靠的是模式匹配，不是精确表
  });
});
