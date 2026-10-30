/**
 * 文档数字守卫（scripts/docNumbers.js + scripts/checkProject.js 的 checkDocNumbers）的单测
 *
 * ── 为什么要有这个测试 ──
 *
 *   checkDocNumbers 是个【会让人血压升高的守卫】：
 *   它一旦误报，开发者第一反应就是"把它关掉"——
 *   而守卫一旦被关掉，就等于从来没存在过。
 *
 *   所以这里钉死三件事：
 *     ① 数字一致 → 一条都不报
 *     ② 数字不一致 → 必须报，而且要说清"哪里写成几、实测是几"
 *     ③ 历史归档 / 设计目标 / 举例说明里的旧数字 → 一条都不报
 *
 *   第 ③ 条尤其重要：它守的是"守卫自己的可信度"。
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');

// scripts/docNumbers.js 是纯 CommonJS 的 Node 脚本（不能被 tsc 编译进 out/），
// 所以用 require 加载 —— 路径走变量，避开 tsc 的 rootDir 检查。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const docNumbers = require(path.join(ROOT, 'scripts', 'docNumbers.js'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const checkProject = require(path.join(ROOT, 'scripts', 'checkProject.js'));

const { compareDocNumbers, extractClaims, readDocs, DOC_FILES, SKIP_DOC_RE } = docNumbers;

/** 一份"实测值"样本（数字随便编，只要自洽） */
const STATS = {
  source: { files: 91, lines: 20095 },
  tests: { files: 41, lines: 9140, testFiles: 41 },
  testCases: { total: 622, passed: 622, failed: 0, suites: 181, files: 41 },
  webview: { files: 10, lines: 2379, stylesLines: 1068 },
  tools: { registered: 16, named: 11, readOnly: 4 },
  operations: 9,
  slashCommands: 11,
  mcp: { files: 6, lines: 1317 },
  eval: { tasks: 30, oracles: 30 },
  maxIterations: 30,
};

function doc(text: string) {
  return [{ name: 'README.md', text }];
}

describe('checkDocNumbers —— 文档数字核对', () => {
  describe('① 数字一致 → 一条都不报', () => {
    it('各指标都用当前写法时，全部通过', () => {
      const text = [
        '# 项目',
        '| 源码 | `src/` 非测试 **91 个文件 / 20,095 行** |',
        '| 测试 | **41 个文件 / 9,140 行 / 622 个用例** |',
        '| 工具 | **11 个**（4 只读 + 3 状态 + 3 写 + 1 执行） |',
        '| Agent 管线 | **9 个 Operation**（`src/agent/operations/`） |',
        '| 前端 | `webview-ui/src/` **10 个文件 / 2,379 行** |',
        '| MCP | **stdio 客户端**（`src/agent/mcp/`，6 文件 / 1,317 行） |',
        '| **slashCommands/** | 聊天框内 `/xxx` 命令（11 个） |',
      ].join('\n');

      expect(compareDocNumbers(STATS, doc(text))).toEqual([]);
    });

    it('带千分位的写法和不带千分位算同一个数', () => {
      const withComma = '| 源码 | `src/` 非测试 **91 个文件 / 20,095 行** |';
      const withoutComma = '| 源码 | `src/` 非测试 **91 个文件 / 20095 行** |';
      expect(compareDocNumbers(STATS, doc(withComma))).toEqual([]);
      expect(compareDocNumbers(STATS, doc(withoutComma))).toEqual([]);
    });
  });

  describe('② 数字不一致 → 必须报，而且要说清差在哪', () => {
    it('文件数写错：报出"写了几个 / 实测几个"', () => {
      const text = '| 源码 | `src/` 非测试 **93 个文件 / 20,095 行** |';
      const mismatches = compareDocNumbers(STATS, doc(text));

      expect(mismatches).toHaveLength(1);
      const m = mismatches[0];
      expect(m.metric).toBe('sourceFiles');
      expect(m.claimed).toBe(93);
      expect(m.expected).toBe(91);
      expect(m.doc).toBe('README.md');
      expect(m.line).toBe(1);
      expect(m.label).toContain('源文件数');
    });

    it('行数写错也要能报出来（不是只查文件数）', () => {
      const text = '| 源码 | `src/` 非测试 **91 个文件 / 20,156 行** |';
      const mismatches = compareDocNumbers(STATS, doc(text));

      expect(mismatches.map((m: any) => m.metric)).toEqual(['sourceLines']);
      expect(mismatches[0].claimed).toBe(20156);
      expect(mismatches[0].expected).toBe(20095);
    });

    it('多个指标同时错 → 全部报出来，一条都不漏', () => {
      const text = [
        '| 源码 | `src/` 非测试 **93 个文件 / 20,156 行** |',
        '| 工具 | **9 个** |',
        '| 前端 | `webview-ui/src/` **10 个文件 / 2,000 行** |',
      ].join('\n');
      const mismatches = compareDocNumbers(STATS, doc(text));

      expect(mismatches.map((m: any) => m.metric).sort()).toEqual([
        'sourceFiles',
        'sourceLines',
        'tools',
        'webviewLines',
      ]);
    });

    it('用例数对不上也要报（这是最容易漂的一个数）', () => {
      const text = '| 测试 | **41 个文件 / 9,140 行 / 600 个用例** |';
      const mismatches = compareDocNumbers(STATS, doc(text));

      expect(mismatches.map((m: any) => m.metric)).toContain('testCases');
      expect(mismatches.find((m: any) => m.metric === 'testCases').claimed).toBe(600);
    });
  });

  describe('③ 历史归档 / 设计目标 / 举例说明 → 一条都不报', () => {
    it('归档目录里的旧数字不会被当成不一致', () => {
      // 归档文件的路径在 SKIP_DOC_RE 里 —— 白名单根本不会去读它
      expect(SKIP_DOC_RE.some((re: RegExp) => re.test('docs/archive/ROADMAP_V1.md'))).toBe(true);
      expect(SKIP_DOC_RE.some((re: RegExp) => re.test('docs/issues/12-something.md'))).toBe(true);
      expect(SKIP_DOC_RE.some((re: RegExp) => re.test('docs/audit/2026-10.md'))).toBe(true);
      expect(DOC_FILES.some((f: string) => SKIP_DOC_RE.some((re: RegExp) => re.test(f)))).toBe(
        false,
      );
    });

    it('正文里的"历史快照"标注 → 跳过', () => {
      const text = '| 源码 | `src/` 非测试 **93 个文件 / 20,156 行** |（2026-10-25 的历史快照）';
      expect(compareDocNumbers(STATS, doc(text))).toEqual([]);
    });

    it('设计目标（≥ / 未勾选的待办）→ 跳过', () => {
      expect(compareDocNumbers(STATS, doc('- [ ] npm test ≥ 630 用例全绿'))).toEqual([]);
      expect(compareDocNumbers(STATS, doc('目标：npm test ≥ 630 用例全绿'))).toEqual([]);
    });

    it('术语表里的举例说明（"我要调 3 个工具"）→ 跳过', () => {
      const text = '**通俗解释**：assistant 说"我要调 3 个工具"，但只回了 2 个结果。';
      expect(compareDocNumbers(STATS, doc(text))).toEqual([]);
    });

    it('区间（4~6 个 Operation）和"其余 N 个"→ 跳过', () => {
      expect(compareDocNumbers(STATS, doc('- 改：4~6 个 Operation 回写结论'))).toEqual([]);
      expect(
        compareDocNumbers(STATS, doc('只覆盖 1 个 Operation。其余 8 个 Operation 的结论没有落盘。')),
      ).toEqual([]);
    });

    it('下限写法（622+ 用例）不算不一致', () => {
      const stats = { ...STATS, testCases: { ...STATS.testCases, total: 630 } };
      expect(compareDocNumbers(stats, doc('工程化：622+ 用例、13 项架构守卫'))).toEqual([]);
    });
  });

  describe('④ 抠数字这一步本身', () => {
    it('把指标和声称值一一对上', () => {
      const claims = extractClaims(
        '| 源码 | `src/` 非测试 **91 个文件 / 20,095 行** |',
        'README.md',
      );
      const byMetric = Object.fromEntries(claims.map((c: any) => [c.metric, c.claimed]));

      expect(byMetric.sourceFiles).toBe(91);
      expect(byMetric.sourceLines).toBe(20095);
    });

    it('"非测试"里的"测试"不能被当成测试指标（否则 src 的行数会被算两次）', () => {
      const claims = extractClaims(
        '| 源码 | `src/` 非测试 **91 个文件 / 20,095 行** |',
        'README.md',
      );
      expect(claims.some((c: any) => c.metric === 'testFiles')).toBe(false);
      expect(claims.some((c: any) => c.metric === 'testLines')).toBe(false);
    });

    it('CRLF 行尾的文档也能正常抠出数字（Windows 上编辑的 md 就是 CRLF）', () => {
      const claims = extractClaims(
        '| 源码 | `src/` 非测试 **91 个文件 / 20,095 行** |\r\n| 工具 | **11 个** |\r\n',
        'README.md',
      );
      expect(claims.some((c: any) => c.metric === 'sourceFiles' && c.claimed === 91)).toBe(true);
      expect(claims.some((c: any) => c.metric === 'tools' && c.claimed === 11)).toBe(true);
    });
  });

  describe('⑤ 这个守卫确实挂在项目自检里', () => {
    it('checkProject.js 的检查链里有 checkDocNumbers', () => {
      expect(checkProject.checks.some((c: any) => c.name === 'checkDocNumbers')).toBe(true);
    });
  });
});
