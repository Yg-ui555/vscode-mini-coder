/**
 * 评测方差统计（2026-10-24）
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要这个（一次真实的翻车记录）
 * ─────────────────────────────────────────────────────────────
 *
 *   Phase 1 改造后跑了一次 eval，对比基线：
 *
 *     总 token   -11.5%   ✅ 看起来是巨大的胜利
 *     LLM 调用   -14.8%   ✅
 *
 *     但是逐题看：
 *     05-simple-parse-config            11轮 → 6轮    -53.5%
 *     12-hard-edge-parser                10轮 → 13轮   +50.7%
 *     21-adversarial-ambiguous-optimize   6轮 → 14轮  +233.1%  😱
 *     27-adversarial-hidden-dir-trap     17轮 → 7轮    -65.5%
 *
 *   单看第 21 题会得出"我的优化让某些题恶化了 233%"的结论。
 *   但真相是：LLM 每次跑的路径都不一样，单次运行的噪声极大。
 *
 *   类比：
 *     你想知道"新代码比旧代码快不快"，
 *     但你只测了一次 —— 而这台机器每次跑分能差 20%。
 *     这时候你看到的差异，可能全是噪声。
 *
 *   所以：
 *     要衡量一个改动，必须知道【测量的误差有多大】。
 *     同一个改动跑 N 次，看结果的分布，才知道差异是不是真的。
 *
 * ─────────────────────────────────────────────────────────────
 * 这在评测领域叫什么
 * ─────────────────────────────────────────────────────────────
 *
 *   统计量：
 *     · mean   —— 平均值（最常报的那个）
 *     · stddev —— 标准差（离散程度，越小越稳定）
 *     · cv     —— 变异系数 = 标准差 / 平均值（相对波动，去掉量纲影响）
 *     · min/max —— 极值（区间）
 *
 *   为什么用 cv（变异系数）而不是直接看标准差：
 *     标准差带量纲。token 的标准差是 5000，
 *     对均值 50000 的题来说是 10%，对均值 10000 的题来说是 50%。
 *     cv 去掉量纲，能横向比较不同量级的题。
 *
 *   判定标准（工程惯例）：
 *     两组数据的差异 > 2 倍标准差 → 大概率是真差异
 *     两组数据的差异 < 1 倍标准差 → 大概率是噪声
 *
 * ─────────────────────────────────────────────────────────────
 * 借鉴与区别
 * ─────────────────────────────────────────────────────────────
 *
 *   goose 的做法：状态机测试用「脚本化假 Provider」
 *     （crates/goose/src/agents/state_machine/tests/dummy_api.rs）
 *     api.on("add one").call(ADD, value(1));
 *     —— 确定性、零成本，但它测的是【流程逻辑】，不是【模型能力】
 *
 *   我们的做法：真跑 N 次，测的是【模型能力】的分布
 *     —— 贵、慢、有噪声，但这是唯一能回答
 *        "我的 prompt 改动到底有没有让模型变强"的方法
 *
 *   两者互补：goose 的方法保证「逻辑对」，我们的方法保证「效果对」。
 */

import { TaskResult } from './runner';

/** 单次运行在某题上的观测值 */
export interface Observation {
  verdict: TaskResult['verdict'];
  llmCalls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  cost: number;
}

/** 某题跑 N 次后的统计 */
export interface TaskStatistics {
  taskId: string;
  tier: string;
  title: string;
  /** 跑了几次 */
  runs: number;
  /** 各次运行的原始观测（保留原始数据，便于事后分析） */
  observations: Observation[];

  // ── pass rate ──
  passRate: number;
  /** 各次判定 */
  verdicts: TaskResult['verdict'][];

  // ── token ──
  meanTokens: number;
  stddevTokens: number;
  cvTokens: number;
  minTokens: number;
  maxTokens: number;

  // ── 轮数 ──
  meanCalls: number;
  stddevCalls: number;

  // ── 耗时 ──
  meanDurationMs: number;

  // ── 成本 ──
  meanCost: number;

  /** 是否有波动（token 的 cv 超过 15% 就算波动大） */
  highVariance: boolean;
}

/** 计算标准差（样本标准差，n-1） */
export function stddev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** 计算平均值 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 变异系数 = 标准差 / 平均值（衡量相对波动） */
export function coefficientOfVariation(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return stddev(values) / m;
}

/**
 * 把一次 TaskResult 变成观测值
 */
export function toObservation(r: TaskResult): Observation {
  return {
    verdict: r.verdict,
    llmCalls: r.llmCalls ?? 0,
    totalTokens: r.usage?.totalTokens ?? 0,
    promptTokens: r.usage?.promptTokens ?? 0,
    completionTokens: r.usage?.completionTokens ?? 0,
    durationMs: r.durationMs,
    cost: r.cost?.cost ?? 0,
  };
}

/**
 * 汇总同一题的 N 次运行
 */
export function summarizeRuns(taskId: string, tier: string, title: string, runs: TaskResult[]): TaskStatistics {
  const observations = runs.map(toObservation);
  const tokens = observations.map((o) => o.totalTokens);
  const calls = observations.map((o) => o.llmCalls);

  const passCount = observations.filter((o) => o.verdict === 'pass').length;

  const cvTokens = coefficientOfVariation(tokens);

  return {
    taskId,
    tier,
    title,
    runs: observations.length,
    observations,
    passRate: observations.length ? (passCount / observations.length) * 100 : 0,
    verdicts: observations.map((o) => o.verdict),
    meanTokens: Math.round(mean(tokens)),
    stddevTokens: Math.round(stddev(tokens)),
    cvTokens,
    minTokens: tokens.length ? Math.min(...tokens) : 0,
    maxTokens: tokens.length ? Math.max(...tokens) : 0,
    meanCalls: Number(mean(calls).toFixed(1)),
    stddevCalls: Number(stddev(calls).toFixed(1)),
    meanDurationMs: Math.round(mean(observations.map((o) => o.durationMs))),
    meanCost: Number(mean(observations.map((o) => o.cost)).toFixed(4)),
    highVariance: cvTokens > 0.15,
  };
}

/**
 * 比较两次评测（基线 vs 改造后）的统计显著性
 *
 * 这是整个方差统计的【目的】：
 *   不是"看起来变好了"，而是"这个差异大于测量噪声"。
 *
 * @returns 每个维度的判定
 */
export interface SignificanceCheck {
  dimension: string;
  baselineMean: number;
  newMean: number;
  /** 变化幅度（百分比） */
  changePct: number;
  /** 变化量（绝对值） */
  delta: number;
  /** 合并标准差（两组方差合成的粗略估计） */
  pooledStddev: number;
  /** 变化量是噪声的几倍 */
  sigma: number;
  /** 判定 */
  verdict: '显著改善' | '显著恶化' | '在噪声范围内';
}

export function checkSignificance(
  baseline: number[],
  after: number[],
  dimension: string,
  lowerIsBetter = true,
): SignificanceCheck {
  const bMean = mean(baseline);
  const nMean = mean(after);
  const bStd = stddev(baseline);
  const nStd = stddev(after);

  // 合并标准差（两样本 t 检验的简化版）
  const pooledStddev = Math.sqrt((bStd * bStd + nStd * nStd) / 2);

  const delta = nMean - bMean;
  const changePct = bMean !== 0 ? (delta / bMean) * 100 : 0;

  // sigma：变化量是噪声的几倍
  // ⚠️ 当 pooledStddev = 0（单次运行）时无法判断，
  //    这正是【必须跑多次】的原因 —— 单次运行给不出显著性。
  const sigma = pooledStddev > 0 ? Math.abs(delta) / pooledStddev : Infinity;

  let verdict: SignificanceCheck['verdict'];
  if (pooledStddev === 0) {
    verdict = '在噪声范围内'; // 单次运行，无法判定
  } else if (sigma >= 2) {
    verdict = (lowerIsBetter ? delta < 0 : delta > 0) ? '显著改善' : '显著恶化';
  } else {
    verdict = '在噪声范围内';
  }

  return {
    dimension,
    baselineMean: Math.round(bMean),
    newMean: Math.round(nMean),
    changePct: Number(changePct.toFixed(1)),
    delta: Math.round(delta),
    pooledStddev: Math.round(pooledStddev),
    sigma: Number.isFinite(sigma) ? Number(sigma.toFixed(2)) : Infinity,
    verdict,
  };
}

/**
 * 汇总所有题的统计
 */
export interface SuiteStatistics {
  /** 每题的统计 */
  perTask: TaskStatistics[];
  /** 整组的 pass rate（所有运行的平均） */
  meanPassRate: number;
  /** 全局 token 的 cv —— 衡量整个评测集的稳定程度 */
  suiteCvTokens: number;
  /** 有多少题的波动很大 */
  highVarianceCount: number;
  totalRuns: number;
}

export function summarizeSuite(perTask: TaskStatistics[]): SuiteStatistics {
  const allTokens = perTask.flatMap((t) => t.observations.map((o) => o.totalTokens));
  const meanPass = mean(perTask.map((t) => t.passRate));

  return {
    perTask,
    meanPassRate: Number(meanPass.toFixed(1)),
    suiteCvTokens: Number(coefficientOfVariation(allTokens).toFixed(4)),
    highVarianceCount: perTask.filter((t) => t.highVariance).length,
    totalRuns: perTask.reduce((n, t) => n + t.runs, 0),
  };
}
