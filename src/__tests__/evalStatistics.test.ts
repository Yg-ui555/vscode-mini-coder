/**
 * 评测方差统计的单元测试（2026-10-24）
 *
 * 为什么要有这个测试：
 *   方差统计是「测量工具」的一部分 ——
 *   测量工具有 bug 比被测对象有 bug 更可怕（本项目的核心教训）。
 *   所以统计函数本身必须被测。
 */

import { describe, it, expect } from 'vitest';
import {
  stddev,
  mean,
  coefficientOfVariation,
  summarizeRuns,
  summarizeSuite,
  checkSignificance,
} from '../eval/statistics';
import type { TaskResult } from '../eval/runner';

function makeResult(
  id: string,
  opts: {
    verdict?: TaskResult['verdict'];
    llmCalls?: number;
    tokens?: number;
    durationMs?: number;
    cost?: number;
  } = {},
): TaskResult {
  const tokens = opts.tokens ?? 10000;
  return {
    id,
    tier: '普通档',
    title: id,
    verdict: opts.verdict ?? 'pass',
    fixedCases: [],
    regressions: [],
    stillFailing: [],
    cases: [],
    toolTrace: [],
    changedFiles: [],
    finalAnswer: '',
    durationMs: opts.durationMs ?? 1000,
    llmCalls: opts.llmCalls ?? 10,
    usage: {
      promptTokens: Math.floor(tokens * 0.9),
      completionTokens: Math.floor(tokens * 0.1),
      totalTokens: tokens,
    },
    cost: { cost: opts.cost ?? 0.1 } as any,
  };
}

describe('⭐ 方差统计基础函数', () => {
  it('mean 求平均值', () => {
    expect(mean([10, 20, 30])).toBe(20);
    expect(mean([])).toBe(0);
  });

  it('stddev 用样本标准差（n-1）', () => {
    // [2,4,4,4,5,5,7,9] 的样本标准差 = 2.13809...
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });

  it('stddev 单个值返回 0', () => {
    expect(stddev([42])).toBe(0);
    expect(stddev([])).toBe(0);
  });

  it('cv 是相对波动（去掉量纲）', () => {
    // 均值 100，标准差 10 → cv = 0.1
    const v = [90, 100, 110];
    expect(coefficientOfVariation(v)).toBeCloseTo(0.1, 5);
  });

  it('cv 在均值为 0 时不崩', () => {
    expect(coefficientOfVariation([0, 0, 0])).toBe(0);
  });
});

describe('⭐ summarizeRuns 汇总多次运行', () => {
  it('计算通过率（3 次过 2 次 = 66.7%）', () => {
    const stats = summarizeRuns('t1', '普通档', '题一', [
      makeResult('t1', { verdict: 'pass' }),
      makeResult('t1', { verdict: 'pass' }),
      makeResult('t1', { verdict: 'fail' }),
    ]);
    expect(stats.runs).toBe(3);
    expect(stats.passRate).toBeCloseTo(66.7, 1);
    expect(stats.verdicts).toEqual(['pass', 'pass', 'fail']);
  });

  it('计算 token 的均值 / 标准差 / 极值', () => {
    const stats = summarizeRuns('t1', '普通档', '题一', [
      makeResult('t1', { tokens: 1000 }),
      makeResult('t1', { tokens: 2000 }),
      makeResult('t1', { tokens: 3000 }),
    ]);
    expect(stats.meanTokens).toBe(2000);
    expect(stats.minTokens).toBe(1000);
    expect(stats.maxTokens).toBe(3000);
    expect(stats.stddevTokens).toBe(1000);
  });

  it('⭐ cv > 15% 标记为高波动', () => {
    const stats = summarizeRuns('t1', '普通档', '题一', [
      makeResult('t1', { tokens: 1000 }),
      makeResult('t1', { tokens: 10000 }),
    ]);
    expect(stats.highVariance).toBe(true);
  });

  it('⭐ 稳定的题不标记为高波动', () => {
    const stats = summarizeRuns('t1', '普通档', '题一', [
      makeResult('t1', { tokens: 10000 }),
      makeResult('t1', { tokens: 10100 }),
      makeResult('t1', { tokens: 9900 }),
    ]);
    expect(stats.highVariance).toBe(false);
  });

  it('保留每次运行的原始观测（便于事后分析）', () => {
    const stats = summarizeRuns('t1', '普通档', '题一', [
      makeResult('t1', { llmCalls: 5 }),
      makeResult('t1', { llmCalls: 9 }),
    ]);
    expect(stats.observations).toHaveLength(2);
    expect(stats.observations[0].llmCalls).toBe(5);
    expect(stats.observations[1].llmCalls).toBe(9);
  });
});

describe('⭐ summarizeSuite 汇总整组', () => {
  it('统计高波动题数与总运行次数', () => {
    const perTask = [
      summarizeRuns('t1', '普通档', '一', [
        makeResult('t1', { tokens: 1000 }),
        makeResult('t1', { tokens: 10000 }),
      ]),
      summarizeRuns('t2', '普通档', '二', [
        makeResult('t2', { tokens: 5000 }),
        makeResult('t2', { tokens: 5050 }),
      ]),
    ];
    const suite = summarizeSuite(perTask);
    expect(suite.totalRuns).toBe(4);
    expect(suite.highVarianceCount).toBe(1);
    expect(suite.perTask).toHaveLength(2);
  });

  it('空输入不崩', () => {
    const suite = summarizeSuite([]);
    expect(suite.totalRuns).toBe(0);
    expect(suite.meanPassRate).toBe(0);
  });
});

describe('⭐⭐ checkSignificance —— 判断差异是不是噪声', () => {
  it('差异远大于噪声 → 判定为显著改善', () => {
    const baseline = [10000, 10200, 9800, 10100, 9900];
    const after = [7000, 7100, 6900, 7050, 6950];
    const r = checkSignificance(baseline, after, 'token', true);
    expect(r.verdict).toBe('显著改善');
    expect(r.sigma).toBeGreaterThan(2);
  });

  it('差异在噪声范围内 → 判定为不可信', () => {
    // 两组数据本身波动很大，均值差异只有 1%
    const baseline = [10000, 5000, 15000, 7000, 13000];
    const after = [10100, 5100, 14900, 7100, 12900];
    const r = checkSignificance(baseline, after, 'token', true);
    expect(r.verdict).toBe('在噪声范围内');
  });

  it('⭐ 单次运行（无方差）无法判定 → 必须在噪声范围内', () => {
    // 这正是"必须跑多次"的理由
    const r = checkSignificance([10000], [5000], 'token', true);
    expect(r.verdict).toBe('在噪声范围内');
  });

  it('变差且显著 → 判定为显著恶化', () => {
    const baseline = [5000, 5100, 4900, 5050, 4950];
    const after = [9000, 9100, 8900, 9050, 8950];
    const r = checkSignificance(baseline, after, 'token', true);
    expect(r.verdict).toBe('显著恶化');
  });

  it('higherIsBetter=false 时判定方向相反', () => {
    const baseline = [5000, 5100, 4900];
    const after = [9000, 9100, 8900];
    const r = checkSignificance(baseline, after, 'passRate', false);
    expect(r.verdict).toBe('显著改善');
  });

  it('返回的变化幅度可读', () => {
    const r = checkSignificance([10000, 10000], [5000, 5000], 'token', true);
    expect(r.changePct).toBe(-50);
    expect(r.baselineMean).toBe(10000);
    expect(r.newMean).toBe(5000);
  });
});
