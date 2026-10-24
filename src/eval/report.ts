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
import { TokenUsage } from '../agent/provider';
import { addUsage, emptyUsage, estimateCost } from '../util/cost';

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
  /** ⭐ 全部题目的 token 合计 */
  totalUsage: TokenUsage;
  /** ⭐ 全部题目的估算成本（元） */
  totalCost: number;
  /** ⭐ 价目表是否覆盖了当前模型（false = 用保守默认值，数字仅供参考） */
  priceKnown: boolean;
  /** ⭐ 单题平均成本 */
  avgCost: number;
  /** ⭐ 每通过一题平均花多少钱 —— 比总成本更能横向比较两个方案 */
  costPerPass: number;
  /**
   * ⭐⭐ case 级信号：baseline 挂掉的 case，agent 修好了几个
   *
   * 为什么要有这个指标（2026-10-25）：
   *   任务级 pass rate 只有 0/1 两档，【极易饱和】——
   *   agent 修好了 1 个 case 和修好了 15 个 case，pass rate 都是 100%。
   *   一旦饱和，你就再也看不出"这次改动到底帮了多少"。
   *
   *   case 级把它拆细：分母 = baseline 挂掉的 case 数（= 本题要求达成的全部目标），
   *   分子 = 其中被修好的。同一个任务级 pass rate 100%，
   *   可能是 20/20 也可能是 1/20 —— 这两者的工程含义完全不同。
   */
  targetCases: { fixed: number; total: number; rate: number };
  /** ⭐ 本次消融掉的工具（空数组 = 没消融） */
  ablatedTools: string[];
  results: TaskResult[];
}

export function summarize(results: TaskResult[], meta: {
  model: string;
  provider: string;
  durationMs: number;
  ablatedTools?: string[];
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

  // ⭐ 成本汇总
  let totalUsage = emptyUsage();
  for (const r of results) {
    if (r.usage) totalUsage = addUsage(totalUsage, r.usage);
  }
  const totalCost = estimateCost(totalUsage, meta.model).cost;

  // ⭐⭐ case 级信号：baseline 挂掉的 case 里，agent 修好了几个
  //
  //   分母 = baseline 失败的 case 数（本题要求达成的全部目标）
  //   分子 = 其中 after 通过的
  //
  //   ⚠️ 注意用"baseline 失败"来定义目标，而不是人工标注"哪些是目标 case" ——
  //     因为 baseline 是自动跑出来的，和人工标注不会不一致。
  let targetFixed = 0;
  let targetTotal = 0;
  for (const r of results) {
    for (const c of r.cases) {
      if (c.baseline) continue; // baseline 就过的 = 回归守卫，不算目标
      targetTotal++;
      if (c.after) targetFixed++;
    }
  }

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
    totalUsage,
    totalCost,
    priceKnown: estimateCost(totalUsage, meta.model).priceKnown,
    avgCost: results.length
      ? Math.round((totalCost / results.length) * 10000) / 10000
      : 0,
    // 全军覆没时用 pass 兜底会得到 Infinity，那种数字放进报告就是误导，直接记 0
    costPerPass: pass ? Math.round((totalCost / pass) * 10000) / 10000 : 0,
    targetCases: {
      fixed: targetFixed,
      total: targetTotal,
      rate: targetTotal ? Math.round((targetFixed / targetTotal) * 100) : 0,
    },
    ablatedTools: meta.ablatedTools ?? [],
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
  if (s.ablatedTools.length > 0) {
    lines.push('');
    lines.push(
      `> 🧪 **消融模式**：本次摘掉了 \`${s.ablatedTools.join('`, `')}\`` +
        ` —— LLM 的工具清单里没有它们。`,
    );
    lines.push('> 这是对照实验，数字**不代表真实能力**，只用来回答"这题到底在测什么"。');
  }
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
  lines.push(
    `| **目标 case 修好率** | **${s.targetCases.rate}%**（${s.targetCases.fixed}/${s.targetCases.total}）|`,
  );
  lines.push('');
  lines.push(
    '> ⭐ **两个指标要一起看**：任务级 pass rate 只有 0/1 两档，极易饱和 —— ' +
      '修好 1 个 case 和修好 15 个 case 都是 100%。',
  );
  lines.push(
    '> case 级修好率把它拆细了：分母是 baseline 挂掉的 case 数（本题要求达成的全部目标）。',
  );
  lines.push('');

  // ── 成本 ──
  // pass rate 打满之后，唯一还有区分度的信号就是"谁更便宜"。
  lines.push('## 成本');
  lines.push('');
  if (!s.priceKnown) {
    lines.push(
      '> ⚠️ 模型 `' +
        s.model +
        '` 不在价目表里，下面用的是保守默认值估算，**只看相对大小，别当绝对金额**。',
    );
    lines.push('> 在 `src/util/cost.ts` 的 `MODEL_PRICES` 里补一条就能变准。');
    lines.push('');
  }
  lines.push('| 指标 | 数值 |');
  lines.push('|---|---|');
  lines.push(`| 总 token | ${s.totalUsage.totalTokens.toLocaleString('en-US')} |`);
  lines.push(
    `| ├ 输入 | ${s.totalUsage.promptTokens.toLocaleString('en-US')} |`,
  );
  lines.push(
    `| └ 输出 | ${s.totalUsage.completionTokens.toLocaleString('en-US')} |`,
  );
  lines.push(`| **总成本** | **¥${s.totalCost.toFixed(4)}** |`);
  lines.push(`| 单题均摊 | ¥${s.avgCost.toFixed(4)} |`);
  lines.push(`| 每通过一题 | ${s.pass ? `¥${s.costPerPass.toFixed(4)}` : '—（没通过任何题）'} |`);
  lines.push('');

  // 最贵的三题 —— 通常就是 prompt 反复膨胀的那几题
  const byCost = [...s.results]
    .filter((r) => r.cost)
    .sort((a, b) => (b.cost!.cost || 0) - (a.cost!.cost || 0));
  if (byCost.length > 0) {
    lines.push('### 最贵的 3 题');
    lines.push('');
    lines.push('| 题目 | 结果 | LLM 轮数 | token | 成本 |');
    lines.push('|---|---|---|---|---|');
    for (const r of byCost.slice(0, 3)) {
      const icon =
        r.verdict === 'pass'
          ? '✅'
          : r.verdict === 'regressed'
            ? '⚠️'
            : r.verdict === 'error'
              ? '🔧'
              : '❌';
      lines.push(
        `| ${r.id} ${r.title} | ${icon} | ${r.llmCalls ?? 0} | ` +
          `${(r.usage?.totalTokens ?? 0).toLocaleString('en-US')} | ¥${(r.cost?.cost ?? 0).toFixed(4)} |`,
      );
    }
    lines.push('');
    lines.push(
      '> 判读：**贵的题不一定是难题**，更常见的原因是 agent 在原地打转——' +
        '每轮都把全量上下文重发一遍，轮数一多 token 就线性涨。轮数比 token 更值得盯。',
    );
    lines.push('');
  }

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
  lines.push('| 题目 | 档位 | 结果 | 目标case | 回归 | 用时 | 轮数 | token | 成本 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of s.results) {
    const icon =
      r.verdict === 'pass' ? '✅' : r.verdict === 'regressed' ? '⚠️' : r.verdict === 'error' ? '🔧' : '❌';
    // ⭐ 分母 = baseline 挂掉的 case 数（本题要求达成的全部目标）
    const targetTotal = r.cases.filter((c) => !c.baseline).length;
    lines.push(
      `| ${r.id} | ${TIER_LABEL[r.tier as TaskTier] || r.tier} | ${icon} ${r.verdict} | ` +
        `${r.fixedCases.length}/${targetTotal} | ${r.regressions.length} | ${(r.durationMs / 1000).toFixed(1)}s | ` +
        `${r.llmCalls ?? 0} | ${(r.usage?.totalTokens ?? 0).toLocaleString('en-US')} | ` +
        `¥${(r.cost?.cost ?? 0).toFixed(4)} |`,
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