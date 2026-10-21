/**
 * autoTest 测试 —— 覆盖 2026-10-21 重写时修掉的三个 bug
 *
 * 这三个 bug 的共同特点：单元测试全绿，但功能实际是坏的。
 * 所以这里测的不是"函数返回了什么"，而是"用户改源码会不会真的触发测试"。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  isTestFile,
  findRelatedTests,
  detectProjectType,
  buildTestCommand,
  didTestsPass,
  parsePytest,
  parseNodeTest,
  truncateKeepTail,
} from '../../features/autoTest';
import { setWorkspaceRoot } from '../../agent/tools/paths';

describe('autoTest 判定逻辑', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mini-coder-autotest-'));
    setWorkspaceRoot(tmpDir);
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  // ────────────── bug 1：触发条件反了 ──────────────

  describe('isTestFile', () => {
    it('识别常见测试文件约定', () => {
      expect(isTestFile(path.join('p', 'tests', 'test_x.py'))).toBe(true);
      expect(isTestFile(path.join('p', '__tests__', 'x.ts'))).toBe(true);
      expect(isTestFile(path.join('p', 'src', 'a.test.ts'))).toBe(true);
      expect(isTestFile(path.join('p', 'src', 'a.spec.js'))).toBe(true);
      expect(isTestFile(path.join('p', 'tests', 'test_parser.py'))).toBe(true);
      expect(isTestFile(path.join('p', 'src', 'parser_test.py'))).toBe(true);
    });

    it('⭐ 普通源码文件【不能】被误判成测试文件', () => {
      // 这就是原来那个 bug 的反面：原来用 includes('test')，
      // 会把 contest.js、latest.md 之类也当成测试
      expect(isTestFile(path.join('p', 'src', 'helper.ts'))).toBe(false);
      expect(isTestFile(path.join('p', 'src', 'contest.js'))).toBe(false);
      expect(isTestFile(path.join('p', 'src', 'latest.ts'))).toBe(false);
      expect(isTestFile(path.join('p', 'src', 'app.py'))).toBe(false);
    });
  });

  // ────────────── bug 2 & 3：退出码判定 ──────────────

  describe('didTestsPass', () => {
    it('⭐ 关键回归：pytest 的 "3 failed, 5 passed" 必须判为【失败】', () => {
      // 这行输出里明明有 "passed"，但 exitCode 非 0 表示测试挂了。
      // 原来的 includes('passed') 在这里会误判成通过，
      // 于是永远不会触发 AI 修复 —— 整个特色的核心闭环断了。
      const output = '===== 1 failed, 3 passed in 0.42s =====';
      expect(didTestsPass(output, 1)).toBe(false);
      expect(didTestsPass(output, 0)).toBe(true);
    });

    it('exitCode=0 → 通过（哪怕输出里有 failed 字样，比如 skip 提示）', () => {
      expect(didTestsPass('5 passed, 0 failed', 0)).toBe(true);
    });

    it('拿不到退出码时才退化到文本判断，且必须排除 failed/error', () => {
      expect(didTestsPass('3 passed', null)).toBe(true);
      expect(didTestsPass('1 failed, 3 passed', null)).toBe(false);
      expect(didTestsPass('ERROR: collection failed', null)).toBe(false);
    });
  });

  // ────────────── 命令构造 ──────────────

  describe('buildTestCommand', () => {
    it('⭐ 必须用相对路径 + 正斜杠', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}', 'utf-8');
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      const testFile = path.join(tmpDir, 'src', 'a.test.ts');

      const cmd = buildTestCommand(testFile, tmpDir);

      expect(cmd).toContain('src/a.test.ts');
      // 绝不能出现反斜杠：vitest 拿它当过滤条件时反斜杠匹配不上，等于什么都没测
      expect(cmd).not.toContain('\\');
      expect(cmd).not.toContain(tmpDir); // 不含绝对路径
    });

    it('python 项目用 pytest', () => {
      fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '', 'utf-8');
      const cmd = buildTestCommand(path.join(tmpDir, 'tests', 'test_a.py'), tmpDir);
      expect(cmd).toContain('pytest');
    });
  });

  describe('detectProjectType', () => {
    it('有 pyproject/requirements → py', () => {
      fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'flask', 'utf-8');
      expect(detectProjectType(tmpDir)).toBe('py');
    });
    it('否则 → node', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}', 'utf-8');
      expect(detectProjectType(tmpDir)).toBe('node');
    });
  });

  // ────────────── 相关测试查找 ──────────────

  describe('findRelatedTests', () => {
    beforeEach(async () => {
      await fsp.mkdir(path.join(tmpDir, 'src', 'utils'), { recursive: true });
      await fsp.mkdir(path.join(tmpDir, 'tests'), { recursive: true });
      await fsp.mkdir(path.join(tmpDir, 'node_modules', 'pkg'), { recursive: true });

      await fsp.writeFile(
        path.join(tmpDir, 'src', 'utils', 'helper.js'),
        'export function helper() { return 42; }',
        'utf-8',
      );
      await fsp.writeFile(
        path.join(tmpDir, 'tests', 'helper.test.js'),
        "const { helper } = require('../src/utils/helper');\ntest('works', () => helper());",
        'utf-8',
      );
      await fsp.writeFile(
        path.join(tmpDir, 'tests', 'unrelated.test.js'),
        "const { thing } = require('../src/other');\ntest('other', () => thing());",
        'utf-8',
      );
      // node_modules 里有同名文件，必须被忽略
      await fsp.writeFile(
        path.join(tmpDir, 'node_modules', 'pkg', 'helper.test.js'),
        "require('helper');",
        'utf-8',
      );
    });

    it('找到引用了该模块的测试', async () => {
      const src = path.join(tmpDir, 'src', 'utils', 'helper.js');
      const related = findRelatedTests(src, tmpDir);

      expect(related.some((r) => r.includes('helper.test.js'))).toBe(true);
    });

    it('⭐ 不相关的测试不该被卷进来（跑错测试比不跑更烦）', async () => {
      const src = path.join(tmpDir, 'src', 'utils', 'helper.js');
      const related = findRelatedTests(src, tmpDir);

      expect(related.some((r) => r.includes('unrelated.test.js'))).toBe(false);
    });

    it('⭐ node_modules 里的同名测试文件被忽略', async () => {
      const src = path.join(tmpDir, 'src', 'utils', 'helper.js');
      const related = findRelatedTests(src, tmpDir);

      expect(related.some((r) => r.includes('node_modules'))).toBe(false);
    });
  });

  // ────────────── 输出解析 ──────────────

  describe('输出解析', () => {
    it('pytest 输出解析', () => {
      const r = parsePytest('===== 3 failed, 5 passed in 0.42s =====');
      expect(r.passed).toBe(5);
      expect(r.failed).toBe(3);
      expect(r.total).toBe(8);
    });

    it('vitest 输出解析', () => {
      const r = parseNodeTest(' Tests  2 failed | 10 passed (12)');
      expect(r.passed).toBe(10);
      expect(r.failed).toBe(2);
    });

    it('jest 输出解析', () => {
      const r = parseNodeTest('Tests: 1 failed, 7 passed, 8 total');
      expect(r.passed).toBe(7);
      expect(r.failed).toBe(1);
    });

    it('truncateKeepTail 保留尾部报错', () => {
      const text = 'A'.repeat(5000) + '\nERROR: the real failure is here';
      const r = truncateKeepTail(text, 1000);
      // 尾部必须保住 —— 报错信息在末尾
      expect(r).toContain('the real failure is here');
      expect(r.length).toBeLessThanOrEqual(1200);
    });
  });
});