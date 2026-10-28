/**
 * ⭐ 回归测试：评测报告【分流】
 *
 * ── 这条测试是被一次真实事故逼出来的 ──
 *
 *   2026-10-28：跑了一次 `npm run eval:dry`（不花钱的框架自检），
 *   结果正式基线 `eval/RESULTS.md` 被 dry 模式的数据【整个覆盖】——
 *   pass rate 从 93% 掉到 3%。
 *
 *   而 dry 模式【根本没有调用任何 LLM】，那 29 个 fail 全部是
 *   mock provider 造出来的假象。
 *
 *   为什么这个 bug 严重到必须写测试：
 *     eval/RESULTS.md 是这个项目【对外展示能力基线】的唯一出处。
 *     README 顶部的徽章、docs/RESUME.md 里的数字、
 *     面试时递出去的那份评测报告 —— 全部引用它。
 *
 *     一条随手敲的 `npm run eval:dry` 就能把它冲掉，
 *     而且【没有任何报错】，要等到下次 `git status` 才会发现文件变了。
 *
 *     比喻：实验室里那个贴着"合格样本"标签的展柜，
 *     任何人拿个空烧杯往里一放，展品就变成空杯子了 —— 而且没人会发现。
 *
 * ── 这个测试就是那道护栏 ──
 *
 *   它断言的核心命题只有一句：
 *     【只有"全量 + 真实 LLM"的跑批，才允许写正式基线 RESULTS.md】
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 只 mock 写盘动作，其余 fs 能力保持真实
vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
  };
});

import * as fs from 'fs';
import { summarize, writeReports, ReportVariant } from '../../eval/report';

/** 造一个合法的 summary —— 用 summarize 自己生成，避免手写字段遗漏 */
function makeSummary() {
  return summarize([], {
    model: 'deepseek-chat',
    provider: 'deepseek',
    durationMs: 1234,
  });
}

/** 取出本次 writeReports 写过的所有文件路径 */
function writtenPaths(): string[] {
  return (fs.writeFileSync as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
    (c) => String(c[0]),
  );
}

/** 取出写进某个文件的内容 */
function writtenContent(suffix: string): string | undefined {
  const calls = (fs.writeFileSync as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const hit = calls.find((c) => String(c[0]).endsWith(suffix));
  return hit ? String(hit[1]) : undefined;
}

describe('评测报告分流（2026-10-28 事故回归）', () => {
  beforeEach(() => {
    (fs.writeFileSync as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it('full 变体写的就是正式基线文件名', () => {
    const r = writeReports(makeSummary(), 'full');
    expect(r.md).toMatch(/RESULTS\.md$/);
    expect(r.json).toMatch(/results\.json$/);
  });

  it('默认参数等价于 full（不传 variant 不会误伤正式报告）', () => {
    const r = writeReports(makeSummary());
    expect(r.md).toMatch(/RESULTS\.md$/);
  });

  // ⭐ 核心断言：dry / partial / ablation 三种跑批，
  //    一个字节都不许写进 RESULTS.md
  it.each(['dry', 'partial', 'ablation'] as ReportVariant[])(
    '%s 变体绝不覆盖正式基线 RESULTS.md',
    (variant) => {
      const r = writeReports(makeSummary(), variant);

      // ① 返回的路径不是正式基线
      expect(r.md).not.toMatch(/RESULTS\.md$/);

      // ② 实际落盘的所有文件里，没有一个是正式基线
      const touchedBaseline = writtenPaths().some((p) => /(^|[\\/])RESULTS\.md$/.test(p));
      expect(touchedBaseline).toBe(false);

      // ③ json 同理
      const touchedBaselineJson = writtenPaths().some((p) => /(^|[\\/])results\.json$/.test(p));
      expect(touchedBaselineJson).toBe(false);
    },
  );

  it('dry 写到独立文件，不与正式基线同名', () => {
    const r = writeReports(makeSummary(), 'dry');
    expect(r.md).toMatch(/RESULTS\.dry\.md$/);
    expect(r.json).toMatch(/results\.dry\.json$/);
  });

  it('partial 写到独立文件（CI 的 2 题冒烟就是这一类）', () => {
    const r = writeReports(makeSummary(), 'partial');
    expect(r.md).toMatch(/RESULTS\.partial\.md$/);
    expect(r.json).toMatch(/results\.partial\.json$/);
  });

  it('ablation 写到独立文件（消融实验必然比基线低，不能覆盖基线）', () => {
    const r = writeReports(makeSummary(), 'ablation');
    expect(r.md).toMatch(/RESULTS\.ablation\.md$/);
    expect(r.json).toMatch(/results\.ablation\.json$/);
  });

  it('dry 报告顶部有"没调 LLM、不代表真实能力"的警示', () => {
    writeReports(makeSummary(), 'dry');
    const content = writtenContent('RESULTS.dry.md');
    expect(content).toBeDefined();
    expect(content).toContain('没有调用任何 LLM');
    expect(content).toContain('不代表真实能力');
    // 必须指向正式基线，让人一眼知道去哪看真的
    expect(content).toContain('RESULTS.md');
  });

  it('partial / ablation 报告顶部也都有警示横幅', () => {
    for (const [variant, marker] of [
      ['partial', '子集评测'],
      ['ablation', '消融实验'],
    ] as [ReportVariant, string][]) {
      (fs.writeFileSync as unknown as ReturnType<typeof vi.fn>).mockClear();
      writeReports(makeSummary(), variant);
      const content = writtenContent(`RESULTS.${variant}.md`);
      expect(content).toBeDefined();
      expect(content).toContain(marker);
      expect(content).toContain('RESULTS.md');
    }
  });

  it('正式基线报告【没有】警示横幅（它是唯一对外展示的那份）', () => {
    writeReports(makeSummary(), 'full');
    const content = writtenContent('RESULTS.md');
    expect(content).toBeDefined();
    expect(content).not.toContain('这是一次子集评测');
    expect(content).not.toContain('这是 dry run');
    expect(content).not.toContain('这是一次消融实验');
  });
});
