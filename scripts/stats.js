#!/usr/bin/env node
/**
 * ⭐⭐ 数字权威源（single source of truth）
 *
 * ── 为什么要有这个文件 ──
 *
 *   这个项目对外的核心卖点是「每条数字都能复现」。
 *   但手写的数字必然会漂：
 *     · 加一个测试文件 → 「37 个测试文件」过期
 *     · 加 11 个用例     → 「529 个用例」过期
 *     · 跑一次评测      → README 徽章里的 pass rate 过期
 *     · 重新打包        → 「VSIX 0.36 MB / 88 个文件」过期
 *
 *   而且这种漂移是【完全静默的】：
 *     文档不会报错，测试不会失败，git 不会拦你。
 *     只有面试官打开两个页面一对照才会发现 —— 那时候已经晚了。
 *
 *   真实案例（2026-10-28）：
 *     README 顶部徽章写「eval-30 题 · 100%」，
 *     而 eval/RESULTS.md 里躺着的最新数据是「93%（28/30）」。
 *     两句话在同一��仓库里互相矛盾 —— 面试官一对照就是「数据不实」。
 *
 * ── 所以 ──
 *
 *   ① 这个脚本是所有数字的【唯一真相源】：跑一次拿到全部权威值
 *   ② scripts/checkProject.js 的 checkDocNumbers 会拿它去比对各文档
 *   ③ 任何一处对不上 → CI 立刻变红 → 漂移不可能流到面试现场
 *
 * ── 统计口径（全项目统一，必须写进 README）──
 *
 *   行数 = fs.readFileSync(f, 'utf-8').split('\n').length
 *         （物理行数，【含空行】）
 *
 *   ⚠️ 不用 PowerShell 的 `Measure-Object -Line` —— 它不计空行，会低估 17%。
 *   ⚠️ 不用 `.split('\n').length - 1` —— 那样最后一行没换行结尾时会少算 1。
 *
 * ── 运行方式 ──
 *
 *   node scripts/stats.js            # 人读的表格
 *   node scripts/stats.js --json     # 机器读（checkDocNumbers 用这个）
 *   node scripts/stats.js --test     # 连用例数一起统计（会跑一遍 vitest，慢）
 *
 *   退出码：0 = 正常；1 = 统计过程出错
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/* ══════════════════════════════════════════════════════════════
 * 基础工具
 * ══════════════════════════════════════════════════════════════ */

/** 统一的行数口径：物理行数（含空行） */
function countLines(file) {
  return fs.readFileSync(file, 'utf-8').split('\n').length;
}

function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}

function totalLines(files) {
  let n = 0;
  for (const f of files) n += countLines(f);
  return n;
}

/* ══════════════════════════════════════════════════════════════
 * 各项统计
 * ══════════════════════════════════════════════════════════════ */

/** src/ 非测试源码 */
function statSource() {
  const files = listFiles(path.join(ROOT, 'src')).filter(
    (f) => f.endsWith('.ts') && !f.includes(`${path.sep}__tests__${path.sep}`),
  );
  return { files: files.length, lines: totalLines(files) };
}

/** src/__tests__/ 测试 */
function statTests() {
  const dir = path.join(ROOT, 'src', '__tests__');
  const all = listFiles(dir).filter((f) => f.endsWith('.ts'));
  const testFiles = all.filter((f) => f.endsWith('.test.ts'));
  return {
    files: testFiles.length,
    lines: totalLines(all),
    testFiles: testFiles.length,
  };
}

/** 用例数 —— 需要跑 vitest，太慢，默认不跑 */
function statTestCases(runVitest) {
  if (!runVitest) return null;
  try {
    const out = execSync(
      'npx vitest run --reporter=json --outputFile=.tmp/vitest-stats.json',
      { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 },
    );
    void out;
    const raw = fs.readFileSync(path.join(ROOT, '.tmp', 'vitest-stats.json'), 'utf-8');
    const j = JSON.parse(raw);
    return {
      total: j.numTotalTests,
      passed: j.numPassedTests,
      failed: j.numFailedTests,
      files: j.numTotalTestSuites,
    };
  } catch (e) {
    return null;
  }
}

/** webview-ui/src/ 前端 */
function statWebview() {
  const files = listFiles(path.join(ROOT, 'webview-ui', 'src')).filter(
    (f) => /\.(tsx|ts|css)$/.test(f),
  );
  const styles = files.filter((f) => f.endsWith('styles.css'));
  return {
    files: files.length,
    lines: totalLines(files),
    stylesLines: styles.length ? countLines(styles[0]) : 0,
  };
}

/** 工具数：从 factory.ts 的注册语句里抠 */
function statTools() {
  const factory = fs.readFileSync(path.join(ROOT, 'src', 'agent', 'tools', 'factory.ts'), 'utf-8');
  const registered = [...factory.matchAll(/register\(new\s+(\w+)\(\)/g)].map((m) => m[1]);

  const meta = fs.readFileSync(path.join(ROOT, 'src', 'agent', 'tools', 'meta.ts'), 'utf-8');
  const rm = meta.match(/export const ReadOnlyToolNames\s*=\s*\[([\s\S]*?)\]\s*as const;/);
  // ⚠️ 这里必须留【名字数组】，不能只留个数：
  //   下面展开 `...ReadOnlyToolNames` 时要用它。
  //   （2026-10-28 修：之前只留了个数 `readOnly`，展开那行还在用不存在的
  //    `readOnlyNames` → `npm run stats` 直接 ReferenceError 崩掉。
  //    之所以一直没人发现：这个脚本不在任何 CI job 里。）
  const readOnlyNames = rm ? [...rm[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  const readOnly = readOnlyNames.length;

  // 名字数（含展开的 ReadOnlyToolNames）—— 用 Set 去重，
  // 因为工厂里可能有多个类映射到同一个工具名
  const am = factory.match(/export const ALL_TOOL_NAMES\s*=\s*\[([\s\S]*?)\];/);
  const namedSet = new Set();
  if (am) {
    for (const line of am[1].split('\n')) {
      if (line.includes('...ReadOnlyToolNames')) {
        for (const n of readOnlyNames) namedSet.add(n);
        continue;
      }
      for (const m of line.matchAll(/'([^']+)'/g)) namedSet.add(m[1]);
    }
  }

  return { registered: registered.length, named: namedSet.size, readOnly };
}

/** 评测题数 + oracle 覆盖 */
function statEval() {
  const tasksDir = path.join(ROOT, 'eval', 'tasks');
  const tasks = fs.existsSync(tasksDir)
    ? fs
        .readdirSync(tasksDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^\d\d-/.test(d.name))
    : [];
  const oracleDir = path.join(ROOT, 'eval', 'oracles');
  const oracles = fs.existsSync(oracleDir)
    ? fs.readdirSync(oracleDir).filter((f) => f.endsWith('.solution.js'))
    : [];
  return { tasks: tasks.length, oracles: oracles.length };
}

/** 从 eval/RESULTS.md 里解析最新一次全量评测的 pass rate */
function statEvalResult() {
  const p = path.join(ROOT, 'eval', 'RESULTS.md');
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, 'utf-8');
  const rate = src.match(/\*\*Pass Rate\*\*\s*\|\s*\*\*(\d+)%\*\*（(\d+)\/(\d+)）/);
  const date = src.match(/生成时间：\s*([\d-]+)/);
  if (!rate) return null;
  return {
    passRate: Number(rate[1]),
    pass: Number(rate[2]),
    total: Number(rate[3]),
    date: date ? date[1] : null,
  };
}

/** VSIX 体积与文件数（文件数从 vsce ls 清单里数） */
function statVsix() {
  const dir = path.join(ROOT, 'eval');
  void dir;
  const out = [];
  for (const f of fs.readdirSync(ROOT)) {
    if (f.endsWith('.vsix')) {
      const st = fs.statSync(path.join(ROOT, f));
      out.push({
        name: f,
        bytes: st.size,
        // ⚠️ 必须是 1024 * 1024 —— 少写一个 1024 就会把 389KB 显示成 389MB
        mb: Math.round((st.size / 1024 / 1024) * 100) / 100,
      });
    }
  }
  return out;
}

/** 迭代上限（单一真相源） */
function statLimits() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'agent', 'limits.ts'), 'utf-8');
  const m = src.match(/export const MAX_ITERATIONS\s*=\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

/* ══════════════════════════════════════════════════════════════
 * 组装
 * ══════════════════════════════════════════════════════════════ */

function collect(runVitest) {
  return {
    source: statSource(),
    tests: statTests(),
    testCases: statTestCases(runVitest),
    webview: statWebview(),
    tools: statTools(),
    eval: statEval(),
    evalResult: statEvalResult(),
    vsix: statVsix(),
    maxIterations: statLimits(),
  };
}

function printHuman(s) {
  const L = [];
  L.push('');
  L.push('══════════════════════════════════════════════════════════════');
  L.push(' Mini-Coder 权威数字（scripts/stats.js）');
  L.push('══════════════════════════════════════════════════════════════');

  L.push('');
  L.push('【源码】src/ 非测试 .ts');
  L.push(`  文件数        ${s.source.files}`);
  L.push(`  行数          ${s.source.lines}`);

  L.push('');
  L.push('【测试】src/__tests__/');
  L.push(`  测试文件数    ${s.tests.files}`);
  L.push(`  行数          ${s.tests.lines}`);
  L.push(
    `  用例数        ${s.testCases ? `${s.testCases.total}（通过 ${s.testCases.passed}）` : '未统计（加 --test 参数可算，但要跑一遍 vitest）'}`,
  );

  L.push('');
  L.push('【前端】webview-ui/src/');
  L.push(`  文件数        ${s.webview.files}`);
  L.push(`  行数          ${s.webview.lines}（其中 styles.css ${s.webview.stylesLines}）`);

  L.push('');
  L.push('【工具】');
  L.push(`  注册工具类    ${s.tools.registered}`);
  L.push(`  ALL_TOOL_NAMES ${s.tools.named}（其中只读 ${s.tools.readOnly}）`);

  L.push('');
  L.push('【评测】');
  L.push(`  题目数        ${s.eval.tasks}`);
  L.push(`  oracle 数     ${s.eval.oracles}`);
  if (s.evalResult) {
    L.push(
      `  最近全量      ${s.evalResult.passRate}%（${s.evalResult.pass}/${s.evalResult.total}）· ${s.evalResult.date || '日期未知'}`,
    );
  } else {
    L.push('  最近全量      读不到 eval/RESULTS.md');
  }

  L.push('');
  L.push('【打包】');
  if (s.vsix.length === 0) {
    L.push('  没有 .vsix（跑 npm run vscode:package 生成）');
  } else {
    for (const v of s.vsix) {
      L.push(`  ${v.name}  ${v.mb} MB（${v.bytes} 字节）`);
    }
  }

  L.push('');
  L.push('【运行时】');
  L.push(`  最大迭代轮数  ${s.maxIterations}`);

  L.push('');
  L.push('══════════════════════════════════════════════════════════════');
  L.push('');
  return L.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const runVitest = argv.includes('--test');
  const asJson = argv.includes('--json');

  const s = collect(runVitest);

  if (asJson) {
    process.stdout.write(JSON.stringify(s, null, 2));
  } else {
    process.stdout.write(printHuman(s));
  }
}

main();
