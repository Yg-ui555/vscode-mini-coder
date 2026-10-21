/**
 * 成本估算的测试
 *
 * ⭐ 这套测试保护的是"钱算得对不对"，不是"代码跑不跑得通"。
 *
 *   成本估算是拿来【横向比较两个方案】的：方案 A ¥0.02，方案 B ¥0.30。
 *   如果公式本身写反了（input/output 单价搞混、token 单位差 1000 倍），
 *   报告里的数字会非常自信地给出完全错误的结论，而且没人会去核账。
 *   所以这几个 case 是纯手算的，一行一行对出来的。
 */

import { describe, it, expect } from 'vitest';

import {
  MODEL_PRICES,
  DEFAULT_PRICE,
  priceFor,
  estimateCost,
  formatCost,
  emptyUsage,
  addUsage,
} from '../util/cost';
import { summarize, toMarkdown } from '../eval/report';
import type { TaskResult } from '../eval/runner';

const u = (p: number, c: number) => ({
  promptTokens: p,
  completionTokens: c,
  totalTokens: p + c,
});

describe('价目表查询', () => {
  it('精确命中', () => {
    expect(priceFor('deepseek-chat')).toBe(MODEL_PRICES['deepseek-chat']);
  });

  it('⭐ 带版本后缀/前缀的模型名也能命中（deepseek-chat-v3 之类）', () => {
    // DeepSeek 经常换版本号，只写死精确名字会静默掉进默认价
    expect(priceFor('deepseek-chat-v3')).toEqual(MODEL_PRICES['deepseek-chat']);
    expect(priceFor('gpt-4o-2024-08-06')).toEqual(MODEL_PRICES['gpt-4o']);
  });

  it('未知模型回落到保守默认值，而不是 0', () => {
    expect(priceFor('some-unknown-model')).toEqual(DEFAULT_PRICE);
    expect(priceFor('')).toEqual(DEFAULT_PRICE);
  });

  it('默认价高于主流模型价（宁可高估也不要低估）', () => {
    expect(DEFAULT_PRICE.input).toBeGreaterThan(MODEL_PRICES['deepseek-chat'].input);
    expect(DEFAULT_PRICE.output).toBeGreaterThan(MODEL_PRICES['deepseek-chat'].output);
  });
});

describe('成本计算（手算对账）', () => {
  it('⭐ 单价单位是「元 / 100 万 token」，不是「元 / 千」', () => {
    // deepseek-chat: input 2 元/1M, output 8 元/1M
    // 1000 input + 1000 output = (1000/1e6)*2 + (1000/1e6)*8 = 0.002 + 0.008 = 0.01
    const c = estimateCost(u(1000, 1000), 'deepseek-chat');
    expect(c.cost).toBeCloseTo(0.01, 6);
  });

  it('⭐ input 和 output 单价没有搞混（用非对称价目表暴露）', () => {
    // 只喂 input：必须是 2/1M，不能按 output 的 8 算
    const onlyIn = estimateCost(u(1_000_000, 0), 'deepseek-chat');
    expect(onlyIn.cost).toBeCloseTo(2, 6);

    // 只喂 output：必须是 8/1M
    const onlyOut = estimateCost(u(0, 1_000_000), 'deepseek-chat');
    expect(onlyOut.cost).toBeCloseTo(8, 6);
  });

  it('保留 4 位小数：单题几厘钱不会四舍五入成 0', () => {
    // 100 token 的 input ≈ 0.0002 元，直接 Math.round(x*10000)/10000 会保留成 0.0002
    const c = estimateCost(u(100, 0), 'deepseek-chat');
    expect(c.cost).toBeGreaterThan(0);
    expect(c.cost).toBeCloseTo(0.0002, 6);
  });

  it('token 数原样透传，不被四舍五入破坏', () => {
    const c = estimateCost(u(12345, 6789), 'deepseek-chat');
    expect(c.promptTokens).toBe(12345);
    expect(c.completionTokens).toBe(6789);
    expect(c.totalTokens).toBe(19134);
  });

  it('价格已知时 priceKnown=true，未知模型标 false', () => {
    expect(estimateCost(u(100, 100), 'deepseek-chat').priceKnown).toBe(true);
    expect(estimateCost(u(100, 100), 'who-knows-v9').priceKnown).toBe(false);
  });

  it('空用量算出 0 元，不产生 NaN', () => {
    const c = estimateCost(emptyUsage(), 'deepseek-chat');
    expect(c.cost).toBe(0);
    expect(Number.isNaN(c.cost)).toBe(false);
  });

  it('formatCost 输出可读串', () => {
    const s = formatCost(u(12345, 6789), 'deepseek-chat');
    expect(s).toContain('¥');
    expect(s).toMatch(/19,134 tok/);
  });
});

describe('用量累加', () => {
  it('emptyUsage 是全零', () => {
    expect(emptyUsage()).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('⭐ addUsage 是纯函数，不改原对象（累加器被复用时最怕这个）', () => {
    const a = u(1, 2);
    const b = u(10, 20);
    const c = addUsage(a, b);
    expect(c).toEqual({ promptTokens: 11, completionTokens: 22, totalTokens: 33 });
    expect(a).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 }); // 没被改
    expect(b).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
  });

  it('多次累加等价于一次性累加', () => {
    const one = addUsage(addUsage(u(1, 1), u(2, 2)), u(3, 3));
    const many = [u(1, 1), u(2, 2), u(3, 3)].reduce(addUsage, emptyUsage());
    expect(one).toEqual(many);
    expect(one.totalTokens).toBe(12);
  });
});

describe('报告里的成本汇总', () => {
  const mk = (over: Partial<TaskResult>): TaskResult =>
    ({
      id: '01-a',
      tier: 'simple',
      title: 'a',
      verdict: 'pass',
      fixedCases: ['x'],
      regressions: [],
      stillFailing: [],
      cases: [],
      toolTrace: [],
      changedFiles: [],
      finalAnswer: '',
      durationMs: 1000,
      ...over,
    }) as TaskResult;

  it('⭐ 汇总 token 与成本是各题之和', () => {
    const s = summarize(
      [
        mk({ id: '01-a', usage: u(1000, 1000) }),
        mk({ id: '02-b', usage: u(3000, 3000) }),
      ],
      { model: 'deepseek-chat', provider: 'deepseek', durationMs: 10 },
    );
    expect(s.totalUsage.promptTokens).toBe(4000);
    expect(s.totalUsage.totalTokens).toBe(8000);
    // (4000/1e6)*2 + (4000/1e6)*8 = 0.008 + 0.032 = 0.04
    expect(s.totalCost).toBeCloseTo(0.04, 6);
  });

  it('avgCost = 总成本 / 题数', () => {
    const s = summarize(
      [mk({ usage: u(1000, 1000) }), mk({ id: '02-b', usage: u(1000, 1000) })],
      { model: 'deepseek-chat', provider: 'deepseek', durationMs: 10 },
    );
    expect(s.totalCost).toBeCloseTo(0.02, 6);
    expect(s.avgCost).toBeCloseTo(0.01, 6);
  });

  it('⭐ 一题都没过时 costPerPass 是 0 而不是 Infinity', () => {
    const s = summarize([mk({ verdict: 'fail', fixedCases: [], usage: u(1000, 1000) })], {
      model: 'deepseek-chat',
      provider: 'deepseek',
      durationMs: 10,
    });
    expect(s.pass).toBe(0);
    expect(Number.isFinite(s.costPerPass)).toBe(true);
    expect(s.costPerPass).toBe(0);
  });

  it('缺 usage 字段的旧结果文件不会让汇总崩掉', () => {
    const s = summarize([mk({ id: '01-a' })], {
      model: 'deepseek-chat',
      provider: 'deepseek',
      durationMs: 10,
    });
    expect(s.totalUsage.totalTokens).toBe(0);
    expect(s.totalCost).toBe(0);
  });

  it('Markdown 里出现成本小节和逐题成本列', () => {
    const s = summarize(
      [mk({ id: '01-a', usage: u(1000, 1000), llmCalls: 3, cost: estimateCost(u(1000, 1000), 'deepseek-chat') })],
      { model: 'deepseek-chat', provider: 'deepseek', durationMs: 10 },
    );
    const md = toMarkdown(s);
    expect(md).toContain('## 成本');
    expect(md).toContain('总成本');
    expect(md).toContain('每通过一题');
    expect(md).toContain('¥0.0100');
  });

  it('模型不在价目表时，报告明确提示数字不可当绝对金额', () => {
    const s = summarize([mk({ usage: u(1000, 1000) })], {
      model: 'mystery-model-9000',
      provider: 'x',
      durationMs: 10,
    });
    expect(s.priceKnown).toBe(false);
    expect(toMarkdown(s)).toContain('不在价目表');
  });
});