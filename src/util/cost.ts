/**
 * LLM 成本估算
 *
 * ⭐ 为什么需要这个（2026-10-21）
 *
 *   pass rate 已经 100% 之后，"能不能做对"不再有区分度了。
 *   这时候唯一还有工程意义的信号是【成本】：
 *   两个都做对的方案，一个花 0.02 元一个花 0.3 元，这是实打实的差别。
 *
 *   所以评测报告必须能回答："哪题最贵""总共花了多少"。
 *
 * ⚠️ 价格会变。这里的数字是写死的快照，用之前建议核对官网：
 *   DeepSeek  https://api-docs.deepseek.com/quick_start/pricing
 *   MiniMax   https://platform.minimaxi.com/document/price
 *
 *   核对方式：跑一次评测，看总量对不对得上账单；偏差大就改这里。
 */

import { TokenUsage } from '../agent/provider';

/** 元 / 100 万 token */
export interface ModelPrice {
  /** 输入（prompt）单价，元 / 1M token */
  input: number;
  /** 输出（completion）单价，元 / 1M token */
  output: number;
  /** 缓存命中的输入单价（元 / 1M），没有就填 input */
  cachedInput?: number;
}

/**
 * 价格表（元 / 1M token）
 *
 * ⚠️ 快照日期 2026-10，务必以官网为准。
 *
 * ⚠️ 2026-10-22 修正过一处静默失效：
 *   这里原来写的是 `'minimax-M3'`（全小写 m），
 *   而 config.ts 的 defaultModel 是 `'MiniMax-M3'`（大写 M）。
 *   旧的 priceFor 用 `model.startsWith(key)` 匹配，JS 区分大小写，
 *   于是 `'MiniMax-M3'.startsWith('minimax-M3')` → false，
 *   每次都落到 DEFAULT_PRICE(5/15)，而真实价格是 1/4 ——
 *   MiniMax 的成本报告【高估了 5 倍】，而且 priceKnown 一直是 false，
 *   报告里能看到这个标记，只是没人注意。
 *
 *   现在改成大小写不敏感匹配，这类错误不会再发生。
 *   （仍然建议把 key 写成和模型名完全一致，减少不必要的转换。）
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // DeepSeek 官方定价（2025 年公开价）
  'deepseek-chat': { input: 2, output: 8, cachedInput: 0.2 },
  'deepseek-reasoner': { input: 4, output: 16, cachedInput: 0.4 },

  // MiniMax（按 token 量级浮动，这里取中位档）
  'MiniMax-M3': { input: 1, output: 4 },

  // OpenAI（这里按 1 USD ≈ 7.2 元折算）
  'gpt-4o': { input: 18, output: 72 },
  'gpt-4o-mini': { input: 1.1, output: 4.3 },
};

/** 未知模型时用这个保守估价，宁可高估也不要低估 */
export const DEFAULT_PRICE: ModelPrice = { input: 5, output: 15 };

/**
 * 按模型名查价（大小写不敏感）
 *
 * 匹配顺序：精确 → 前缀（模型名常带日期后缀，如 gpt-4o-2024-08-06）
 */
export function priceFor(model: string): ModelPrice {
  if (!model) return DEFAULT_PRICE;
  const target = model.toLowerCase();

  // 1. 精确匹配（忽略大小写）
  for (const [key, price] of Object.entries(MODEL_PRICES)) {
    if (key.toLowerCase() === target) return price;
  }
  // 2. 前缀匹配
  for (const [key, price] of Object.entries(MODEL_PRICES)) {
    if (target.startsWith(key.toLowerCase())) return price;
  }
  return DEFAULT_PRICE;
}

/** 模型是否命中了价目表（供报告标注 priceKnown） */
export function isPriceKnown(model: string): boolean {
  if (!model) return false;
  const target = model.toLowerCase();
  return Object.keys(MODEL_PRICES).some((k) => target.startsWith(k.toLowerCase()));
}

export interface CostBreakdown {
  /** 输入 token */
  promptTokens: number;
  /** 输出 token */
  completionTokens: number;
  /** 合计 token */
  totalTokens: number;
  /** 估算成本（元） */
  cost: number;
  /** 是否命中了价格表（false = 用的是保守默认值） */
  priceKnown: boolean;
}

export function emptyUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/** 按模型价目表算成本（元） */
export function estimateCost(usage: TokenUsage, model: string): CostBreakdown {
  const price = priceFor(model);
  const known = isPriceKnown(model);

  const cost =
    (usage.promptTokens / 1_000_000) * price.input +
    (usage.completionTokens / 1_000_000) * price.output;

  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    // 保留 4 位小数：单题可能只有几厘，四舍五入成 0 就看不出差别了
    cost: Math.round(cost * 10000) / 10000,
    priceKnown: known,
  };
}

/** 人类可读：0.0234 元 / 12345 tok */
export function formatCost(usage: TokenUsage, model: string): string {
  const c = estimateCost(usage, model);
  return `¥${c.cost.toFixed(4)} · ${c.totalTokens.toLocaleString('en-US')} tok`;
}