/**
 * 评测报告生成：JSON（机器读）+ Markdown（人读）
 *
 * Markdown 那份才是你要拿去讲的东西。
 * 结构刻意按"信号强弱"排：pass rate → 回归 → 分档→ 失败分类，
 * 而不是按题目顺序流水账。
 */

import * as fs from 'fs';
import * as path from 'path';

import { TaskResult } from './runner';
import { TaskTier, TIER_LABEL, evalRoot } from './types';

export interface EvalSummary {
  startedAt: string;
  durationMs: number;
  model: string;
  provider: string;
  total: number;
  pass: number;
  fail: number;
  regressed: number;
  error: number;
  passRate: number;
  byTier: Record<TaskTier, { total: number; pass: number; rate: number }>;
  results: TaskResult[];
}

export function summarize(results: TaskResult[], meta: {
  model: string;
  provider: string;
  durationMs: number;
}): EvalSummary {
  const byTier = {} as EvalSummary['byTier'];
  for (const t of ['simple', 'hard', 'adversarial'] as TaskTier[]) {
    byTier[t] = { total: 0, pass: 0, rate: 0 };
  }

  for (const r of results) {
    const b = byTier[r.tier as TaskTier];
    b.total++;
    if (r.verdict === 'pass') b.pass++;
  }
  for (const t of Object.keys(byTier) as TaskTier[]) {
    byTier[t].rate = byTier[t].total
      ? Math.round((byTier[t].pass / byTier[t].total) * 100)
      : 0;
  }

  const pass = results.filter((r) => r.verdict === 'pass').length;
  const fail = results.filter((r) => r.verdict === 'fail').length;
  const regressed = results.filter((r) => r.verdict === 'regressed').length;
  const error = results.filter((r) => r.verdict === 'error').length;

  return {
    startedAt: new Date().toISOString(),
    durationMs: meta.durationMs,
    model: meta.model,
    provider: meta.provider,
    total: results.length,
    pass,
    fail,
    regressed,
    error,
    passRate: results.length ? Math.round((pass / results.length) * 100) : 0,
    byTier,
    results,
  };
}

function pct(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}%` : '—';
}

/** 失败原因归类 —— 这张表比 pass rate 本身值钱 */
function classifyFailures(results: TaskResult[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const push = (k: string, v: string) => {
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(v);
  };

  for (const r of results) {
    if (r.verdict === 'error') {
      push('基础设施错误（跟 agent 无关）', r.id);
      continue;
    }

    // 回归：改坏了原本好的
    if (r.regressions.length > 0) {
      push('⭐ 回归：把原本正确的改坏了', `${r.id} → ${r.regressions.join(', ')}`);
    }

    // 死循环：同一工具同一参数反复调
    const sig = new Map<string, number>();
    for (const t of r.toolTrace) {
      const k = t.tool;
      sig.set(k, (sig.get(k) ?? 0) + 1);
    }
    const maxRepeat = Math.max(0, ...sig.values());
    if (maxRepeat >= 5) {
      push('疑似死循环（单工具调用 ≥5 次）', `${r.id} → 最多重复 ${maxRepeat} 次`);
    }

    // 工具反复报错但没换策略
    const errTools = new Set(r.toolTrace.filter((t) => t.isError).map((t) => t.tool));
    if (errTools.size > 0 && r.fixedCases.length === 0) {
      push('工具报错后未纠正', `${r.id} → ${[...errTools].join(', ')}`);
    }

    // 没动任何文件（对抗题里有时是正确答案，比如"应该拒绝"）
    if (r.changedFiles.length === 0 && r.fixedCases.length === 0) {
      push('未产生任何改动', r.id);
    }

    if (r.fixedCases.length === 0 && r.regressions.length === 0) {
      push('目标未达成', r.id);
    }
  }

  return map;
}

export function toMarkdown(s: EvalSummary): string {
  const lines: string[] = [];

  lines.push('# Mini-Coder 评测报告');
  lines.push('');
  lines.push(`> 生成时间：${s.startedAt}`);
  lines.push(`> 模型：${s.provider} / \`${s.model}\``);
  lines.push(`> 总耗时：${(s.durationMs / 1000).toFixed(1)}s`);
  lines.push('');

  // ── 总览 ──
  lines.push('## 总览');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('|---|---|');
  lines.push(`| **Pass Rate** | **${s.passRate}%**（${s.pass}/${s.total}）|`);
  lines.push(`| 目标未达成 | ${s.fail} |`);
  lines.push(`| ⚠️ 造成回归 | ${s.regressed} |`);
  lines.push(`| 基础设施错误 | ${s.error} |`);
  lines.push('');

  // ── 分档 ──
  lines.push('## 分档表现');
  lines.push('');
  lines.push('| 档位 | 通过 | 通过率 |');
  lines.push('|---|---|---|');
  for (const t of ['simple', 'hard', 'adversarial'] as TaskTier[]) {
    const b = s.byTier[t];
    if (b.total === 0) continue;
    lines.push(`| ${TIER_LABEL[t]} | ${b.pass}/${b.total} | ${b.rate}% |`);
  }
  lines.push('');

  // ── 失败归类（核心）──
  const cls = classifyFailures(s.results);
  if (cls.size > 0) {
    lines.push('## 失败归类');
    lines.push('');
    lines.push('> 这张表比 pass rate 本身更值钱——它直接指出下一步该修什么。');
    lines.push('');
    for (const [k, items] of cls) {
      lines.push(`### ${k}（${items.length}）`);
      lines.push('');
      for (const it of items) lines.push(`- ${it}`);
      lines.push('');
    }
  }

  // ── 回归明细 ──
  const regressed = s.results.filter((r) => r.regressions.length > 0);
  if (regressed.length > 0) {
    lines.push('## ⚠️ 回归明细（L4）');
    lines.push('');
    lines.push('> 原本通过的 case 被 agent 改坏了。这类问题 agent 自己发现不了——');
    lines.push('> 它跑一次测试看到绿色就收工。');
    lines.push('');
    for (const r of regressed) {
      lines.push(`- **${r.id}** ${r.title}`);
      for (const reg of r.regressions) {
        const c = r.cases.find((x) => x.name === reg);
        lines.push(`  - 回归：\`${reg}\`${c?.error ? ` — ${c.error}` : ''}`);
      }
    }
    lines.push('');
  }

  // ── 逐题 ──
  lines.push('## 逐题明细');
  lines.push('');
  lines.push('| 题目 | 档位 | 结果 | 修复/达成 | 回归 | 用时 |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of s.results) {
    const icon =
      r.verdict === 'pass' ? '✅' : r.verdict === 'regressed' ? '⚠️' : r.verdict === 'error' ? '🔧' : '❌';
    lines.push(
      `| ${r.id} | ${TIER_LABEL[r.tier as TaskTier] || r.tier} | ${icon} ${r.verdict} | ` +
        `${r.fixedCases.length} | ${r.regressions.length} | ${(r.durationMs / 1000).toFixed(1)}s |`,
    );
  }
  lines.push('');

  // ── case 级对照（最有用的一张表）──
  lines.push('## Case 级 baseline → after');
  lines.push('');
  lines.push('> 图例：`✅→✅` 一直通过 · `❌→✅` 本题达成 · `✅→❌` ⭐**回归** · `❌→❌` 没达成');
  lines.push('');

  for (const r of s.results) {
    if (r.cases.length === 0) continue;
    lines.push(`<details><summary><b>${r.id}</b> ${r.title}</summary>`);
    lines.push('');
    lines.push('| case | baseline | after | 判定 |');
    lines.push('|---|---|---|---|');
    for (const c of r.cases) {
      const b = c.baseline ? '✅' : '❌';
      const a = c.after ? '✅' : '❌';
      let verdict: string;
      if (c.baseline && c.after) verdict = '保持通过';
      else if (!c.baseline && c.after) verdict = '✅ 达成';
      else if (c.baseline && !c.after) verdict = '⚠️ **回归**';
      else verdict = '未达成';
      lines.push(`| ${c.name} | ${b} | ${a} | ${verdict} |`);
    }
    lines.push('');
    if (r.changedFiles.length > 0) {
      lines.push(`**改动文件**：${r.changedFiles.map((f) => `\`${f}\``).join(' ')}`);
      lines.push('');
    }
    if (r.toolTrace.length > 0) {
      const errCount = r.toolTrace.filter((t) => t.isError).length;
      lines.push(`**工具调用**：${r.toolTrace.length} 次，其中报错 ${errCount} 次`);
      lines.push('');
    }
    lines.push('</details>');
    lines.push('');
  }

  return lines.join('\n');
}

export function writeReports(s: EvalSummary): { md: string; json: string } {
  const root = evalRoot();
  const md = path.join(root, 'RESULTS.md');
  const json = path.join(root, 'results.json');

  fs.writeFileSync(md, toMarkdown(s), 'utf-8');
  fs.writeFileSync(json, JSON.stringify(s, null, 2), 'utf-8');

  return { md, json };
}