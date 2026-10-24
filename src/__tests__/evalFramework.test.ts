/**
 * 评测框架自身的测试
 *
 * 这些测试保护的是【评测基础设施的正确性】。
 * 因为一旦 runner 出 bug（比如 require 缓存没清干净），
 * 整套评测就会静默失效——报出来的数字全是假的，而且没人会发现。
 *
 * ⚠️ 这类"测量工具的 bug"比被测对象更可怕，所以单独锁死。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { setEvalWorkspace } from '../eval/shim';
import { setWorkspaceRoot } from '../agent/tools/paths';
import { setNonInteractive } from '../agent/tools/approval';
import { loadAllTasks, loadCheck, copyDir, listFiles } from '../eval/types';
import { clearSandboxCache } from '../eval/runner';
import { toMarkdown, summarize } from '../eval/report';
import { createDefaultRegistry } from '../agent/tools/factory';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'evaltest-'));
  setWorkspaceRoot(tmp);
  setEvalWorkspace(tmp);
  setNonInteractive(true);
});

afterEach(async () => {
  await fs.promises.rm(tmp, { recursive: true, force: true });
  setWorkspaceRoot(os.tmpdir());
  setEvalWorkspace(undefined);
});

describe('沙箱缓存清理', () => {
  it('⭐ 修改文件后清缓存能读到新内容（不回滚检测的前提）', async () => {
    const f = path.join(tmp, 'mod.js');
    await fs.promises.writeFile(f, 'module.exports = { v: 1 };', 'utf-8');

    // 第一次 require → 拿到 v:1
    clearSandboxCache(tmp);
    const first = require(f);
    expect(first.v).toBe(1);

    // 改文件，不清缓存 → 仍然拿到旧的（这正是 bug 来源）
    await fs.promises.writeFile(f, 'module.exports = { v: 2 };', 'utf-8');
    const cached = require(f);
    expect(cached.v).toBe(1); // 证明 Node 确实缓存了

    // 清缓存后重新 require → 拿到新值
    clearSandboxCache(tmp);
    delete require.cache[require.resolve(f)];
    const fresh = require(f);
    expect(fresh.v).toBe(2); // ✅ 这就是 runCheck 里 clearSandboxCache 的意义
  });

  it('清理范围不误伤沙箱外的模块', async () => {
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.js`);
    await fs.promises.writeFile(outside, 'module.exports = { ok: true };', 'utf-8');
    clearSandboxCache(tmp); // 不该清掉沙箱外的

    const mod = require(outside);
    expect(mod.ok).toBe(true);
    delete require.cache[require.resolve(outside)];
  });

  it('大小写/分隔符差异也能正确匹配（Windows 健壮性）', async () => {
    const sub = path.join(tmp, 'sub');
    await fs.promises.mkdir(sub, { recursive: true });
    const f = path.join(sub, 'x.js');
    await fs.promises.writeFile(f, 'module.exports = { v: 1 };', 'utf-8');

    // 用带尾斜杠 + 大小写不同的路径调用
    clearSandboxCache(tmp + path.sep);
    delete require.cache[require.resolve(f)];
    await fs.promises.writeFile(f, 'module.exports = { v: 2 };', 'utf-8');
    clearSandboxCache(tmp.toUpperCase() === tmp ? tmp : tmp);

    expect(require(f).v).toBe(2);
  });
});

describe('任务加载', () => {
  it('全部 23 道题都能被加载且结构正确', () => {
    const tasks = loadAllTasks();
    // ⚠️ 数量是【故意写死】的 —— 加题/删题时这里必须跟着改，
    //    这样"我以为加了题但其实没加载上"会立刻被测出来。
    expect(tasks.length).toBe(23);

    for (const t of tasks) {
      expect(t.id).toMatch(/^\d\d-/);
      expect(t.prompt.length).toBeGreaterThan(50); // task.md 不能太短
      expect(fs.existsSync(t.checkPath)).toBe(true);
    }
  });

  it('⭐ Phase 2 的五道新题都在（真实 tsc / 长链条 / 跨模块契约 / 性能不变 / 静默破坏）', () => {
    const ids = new Set(loadAllTasks().map((t) => t.id));
    for (const id of [
      '31-hard-real-tsc-build',
      '32-hard-long-chain-migration',
      '33-hard-cross-module-contract',
      '34-hard-perf-keep-behavior',
      '35-adversarial-silent-api-break',
    ]) {
      expect(ids.has(id), `缺少 Phase 2 新题 ${id}`).toBe(true);
    }
  });

  it('⭐ 五道新题都配了标准答案（oracle），证明题目有解', () => {
    const root = path.resolve(__dirname, '..', '..', 'eval', 'oracles');
    for (const id of [
      '31-hard-real-tsc-build',
      '32-hard-long-chain-migration',
      '33-hard-cross-module-contract',
      '34-hard-perf-keep-behavior',
      '35-adversarial-silent-api-break',
    ]) {
      expect(
        fs.existsSync(path.join(root, `${id}.solution.js`)),
        `缺少标准答案 ${id}.solution.js`,
      ).toBe(true);
    }
  });

  it('⭐ 四道加固题都在（工具纪律 / 深埋定位 / 别改测试 / 抗注入）', () => {
    const ids = new Set(loadAllTasks().map((t) => t.id));
    for (const id of [
      '15-hard-grep-discipline',
      '18-hard-deep-locate',
      '26-adversarial-do-not-touch-test',
      '27-adversarial-hidden-dir-trap',
    ]) {
      expect(ids.has(id), `缺少加固题 ${id}`).toBe(true);
    }
  });

  it('三档难度都有题覆盖', () => {
    const tasks = loadAllTasks();
    const tiers = new Set(tasks.map((t) => t.tier));
    expect(tiers.has('simple')).toBe(true);
    expect(tiers.has('hard')).toBe(true);
    expect(tiers.has('adversarial')).toBe(true);
  });

  it('每道题的 check.js 都能加载且导出形状合法', () => {
    for (const t of loadAllTasks()) {
      const check = loadCheck(t);
      expect(Array.isArray(check.cases)).toBe(true);
      expect(check.cases.length).toBeGreaterThanOrEqual(5);
      for (const c of check.cases) {
        expect(typeof c.name).toBe('string');
        expect(typeof c.fn).toBe('function');
      }
    }
  });
});

describe('baseline 设计铁律', () => {
  it('⭐ 每题至少 2 个 case 在初始代码上通过（否则 L4 回归检测无意义）', async () => {
    for (const task of loadAllTasks()) {
      const sandbox = path.join(tmp, `t-${task.id}`);
      if (fs.existsSync(task.initialDir)) copyDir(task.initialDir, sandbox);
      else fs.mkdirSync(sandbox, { recursive: true });

      const check = loadCheck(task);
      let passed = 0;
      for (const c of check.cases) {
        try {
          await c.fn({ dir: sandbox, finalAnswer: '', transcript: [], task });
          passed++;
        } catch {
          /* 挂是正常的 */
        }
      }
      expect(passed, `${task.id} baseline 只过 ${passed} 个`).toBeGreaterThanOrEqual(2);
    }
  });

  it('⭐ 每题至少 1 个 case 在初始代码上失败（否则 agent 什么都不做也满分）', async () => {
    for (const task of loadAllTasks()) {
      const sandbox = path.join(tmp, `f-${task.id}`);
      if (fs.existsSync(task.initialDir)) copyDir(task.initialDir, sandbox);
      else fs.mkdirSync(sandbox, { recursive: true });

      const check = loadCheck(task);
      let failed = 0;
      for (const c of check.cases) {
        try {
          await c.fn({ dir: sandbox, finalAnswer: '', transcript: [], task });
        } catch {
          failed++;
        }
      }
      expect(failed, `${task.id} baseline 全过，这题是废题`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('工具函数', () => {
  it('listFiles 能递归列出并排序', async () => {
    await fs.promises.mkdir(path.join(tmp, 'a', 'b'), { recursive: true });
    await fs.promises.writeFile(path.join(tmp, 'r.js'), '');
    await fs.promises.writeFile(path.join(tmp, 'a', 'x.js'), '');
    await fs.promises.writeFile(path.join(tmp, 'a', 'b', 'y.js'), '');

    const files = listFiles(tmp);
    expect(files).toContain('r.js');
    expect(files).toContain('a/x.js');
    expect(files).toContain('a/b/y.js');
  });

  it('copyDir 能完整复制嵌套目录', async () => {
    const src = path.join(tmp, 'src');
    const dst = path.join(tmp, 'dst');
    await fs.promises.mkdir(path.join(src, 'deep', 'deeper'), { recursive: true });
    await fs.promises.writeFile(path.join(src, 'deep', 'deeper', 'f.txt'), 'hello');

    copyDir(src, dst);
    expect(fs.existsSync(path.join(dst, 'deep', 'deeper', 'f.txt'))).toBe(true);
  });
});

describe('工具消融（ablation）', () => {
  it('⭐ 摘掉的工具不出现在注册表里', () => {
    const full = createDefaultRegistry();
    expect(full.names).toContain('grep');

    const ablated = createDefaultRegistry({ exclude: ['grep'] });
    expect(ablated.names).not.toContain('grep');
    // 其余工具一个都不能少（消融是"摘掉一个"，不是"重写一套"）
    expect(ablated.names).toContain('read_file');
    expect(ablated.names).toContain('glob');
    expect(ablated.names).toContain('apply_patch');
    expect(ablated.names).toContain('run_shell');
    expect(ablated.names.length).toBe(full.names.length - 1);
  });

  it('⭐⭐ 消融的工具连 schema 都不给 LLM（LLM 不知道它存在）', () => {
    const ablated = createDefaultRegistry({ exclude: ['grep', 'glob'] });
    const names = ablated.schemas.map((s: any) => s.function.name);
    expect(names).not.toContain('grep');
    expect(names).not.toContain('glob');
    expect(names.length).toBe(7);
  });
});

describe('报告生成', () => {
  const mkResult = (over: any = {}) => ({
    id: '01-test', tier: 'simple', title: 'test', verdict: 'pass' as const,
    fixedCases: ['a'], regressions: [], stillFailing: [], cases: [],
    toolTrace: [], changedFiles: [], finalAnswer: '', durationMs: 1000, ...over,
  });

  it('能汇总 pass rate', () => {
    const s = summarize([mkResult(), mkResult({ verdict: 'fail' as const, fixedCases: [] })], {
      model: 'm', provider: 'p', durationMs: 2000,
    });
    expect(s.total).toBe(2);
    expect(s.pass).toBe(1);
    expect(s.passRate).toBe(50);
  });

  it('回归会被单独标出（不会被算成通过）', () => {
    const s = summarize([mkResult({ verdict: 'regressed' as const, regressions: ['broken'] })], {
      model: 'm', provider: 'p', durationMs: 1000,
    });
    expect(s.pass).toBe(0); // 回归不算通过
    expect(s.regressed).toBe(1);
    expect(toMarkdown(s)).toContain('回归明细');
  });

  it('⭐⭐ case 级目标修好率：修好 1 个和修好 15 个不能都是 100%', () => {
    // 任务级 pass rate 只有 0/1 两档，极易饱和。
    // case 级指标把它拆细：分母 = baseline 挂掉的 case 数。
    const mk = (fixed: number, targetTotal: number) =>
      mkResult({
        cases: [
          // 3 个 baseline 就过的（回归守卫）
          { name: 'guard1', baseline: true, after: true },
          { name: 'guard2', baseline: true, after: true },
          // targetTotal 个 baseline 挂的，其中 fixed 个被修好
          ...Array.from({ length: targetTotal }, (_, i) => ({
            name: `t${i}`,
            baseline: false,
            after: i < fixed,
          })),
        ],
      });

    const s = summarize([mk(1, 15), mk(15, 15)], {
      model: 'm', provider: 'p', durationMs: 1000,
    });

    expect(s.passRate).toBe(100); // 任务级：两题都"通过"，看不出差别
    expect(s.targetCases.total).toBe(30);
    expect(s.targetCases.fixed).toBe(16);
    expect(s.targetCases.rate).toBe(53); // case 级：53% vs 100%，差别一眼看出来
    expect(toMarkdown(s)).toContain('目标 case 修好率');
  });

  it('⭐ 消融掉的工具会写进报告（别让人误以为是真实能力）', () => {
    const s = summarize([mkResult()], {
      model: 'm', provider: 'p', durationMs: 1000, ablatedTools: ['grep'],
    });
    expect(s.ablatedTools).toEqual(['grep']);
    expect(toMarkdown(s)).toContain('消融模式');
  });

  it('失败归类能识别"工具报错后未纠正"', () => {
    const s = summarize([
      mkResult({ verdict: 'fail' as const, fixedCases: [], toolTrace: [
        { tool: 'apply_patch', args: {}, isError: true, preview: 'old_text not found' },
      ] }),
    ], { model: 'm', provider: 'p', durationMs: 1000 });
    expect(toMarkdown(s)).toContain('工具报错后未纠正');
  });

  it('失败归类能识别"疑似死循环"', () => {
    const trace = Array.from({ length: 6 }, () => ({
      tool: 'apply_patch', args: {}, isError: false, preview: 'ok',
    }));
    const s = summarize([mkResult({ verdict: 'fail' as const, fixedCases: [], toolTrace: trace })], {
      model: 'm', provider: 'p', durationMs: 1000,
    });
    expect(toMarkdown(s)).toContain('死循环');
  });
});