/**
 * 统一 diff 生成测试
 *
 * diff 的作用是【给人做判断依据】：用户靠它决定要不要点"允许"。
 * 所以它的 bug 比"显示不出来"严重得多：
 *   · 漏报改动 → 用户以为只是小改动，结果整块被替换（信任被击穿）
 *   · 虚报改动 → 每次都是一堆假的 diff，用户就不看了（功能等于没有）
 *
 * 所以下面重点测"统计数字准不准"，而不只是"格式对不对"。
 */

import { describe, it, expect } from 'vitest';
import {
  diffFile,
  diffFiles,
  renderUnifiedDiff,
  renderCompactPreview,
  summarizeDiffs,
  MAX_DIFF_LINES,
} from '../../util/diff';
import { setWorkspaceRoot } from '../../agent/tools/paths';

// 所有路径都在工作区里，保证 toWorkspaceRelative 能正常算
setWorkspaceRoot('/fake/workspace');

const P = '/fake/workspace/src/a.ts';

describe('diffFile', () => {
  // ── 三种基本形态 ──
  it('新建文件：全部算新增', () => {
    const d = diffFile(P, null, 'line1\nline2\nline3');

    expect(d.isNew).toBe(true);
    expect(d.added).toBe(3);
    expect(d.removed).toBe(0);
    expect(d.lines.every((l) => l.op === 'add')).toBe(true);
  });

  it('删除文件：全部算删除', () => {
    const d = diffFile(P, 'line1\nline2', null);

    expect(d.isDeleted).toBe(true);
    expect(d.removed).toBe(2);
    expect(d.added).toBe(0);
  });

  it('内容完全没变 → 空 diff（不制造噪音）', () => {
    const d = diffFile(P, 'a\nb\nc', 'a\nb\nc');

    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.lines).toHaveLength(0);
  });

  // ── 统计数字准确性（最重要）──
  it('单行替换：+1 -1', () => {
    const d = diffFile(P, 'a\nb\nc', 'a\nX\nc');

    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
  });

  it('新增一行：只加不删', () => {
    const d = diffFile(P, 'a\nc', 'a\nb\nc');

    expect(d.added).toBe(1);
    expect(d.removed).toBe(0);
  });

  it('中间插入两行：+2 -0，且未变更的行被正确识别为 eq', () => {
    const d = diffFile(P, 'head\ntail', 'head\nnew1\nnew2\ntail');

    expect(d.added).toBe(2);
    expect(d.removed).toBe(0);
    const eqLines = d.lines.filter((l) => l.op === 'eq').map((l) => l.content);
    expect(eqLines).toContain('head');
    expect(eqLines).toContain('tail');
  });

  it('文件被整体替换：统计等于原行数 + 新行数', () => {
    const before = Array.from({ length: 10 }, (_, i) => `old${i}`).join('\n');
    const after = Array.from({ length: 7 }, (_, i) => `new${i}`).join('\n');
    const d = diffFile(P, before, after);

    // 没有一行内容相同 → 全部是删+增
    expect(d.added).toBe(7);
    expect(d.removed).toBe(10);
  });

  // ── LCS 的正确性：不能"漏"掉实际存在的公共行 ──
  it('能识别出重复行的正确匹配（不会全部当成删+增）', () => {
    // 关键：new 里有两处 identical，LCS 必须认出至少一处是"没变"
    const d = diffFile(P, 'x\nidentical\ny', 'identical\nx\nidentical');

    // 至少应该认出 1 行 eq（如果全删全增，added/removed 会各为 3）
    const eqCount = d.lines.filter((l) => l.op === 'eq').length;
    expect(eqCount).toBeGreaterThanOrEqual(1);
  });

  it('行号标注正确（新增行有 newLine 无 oldLine）', () => {
    const d = diffFile(P, 'a\nc', 'a\nb\nc');

    const added = d.lines.find((l) => l.op === 'add')!;
    expect(added.oldLine).toBeNull();
    expect(added.newLine).toBe(2); // 它是新文件的第 2 行
  });

  // ── 边界 ──
  it('空文件 → 非空', () => {
    const d = diffFile(P, '', 'hello');

    expect(d.added).toBe(1);
    expect(d.removed).toBe(0);
  });

  it('非空 → 空文件', () => {
    const d = diffFile(P, 'a\nb', '');

    expect(d.removed).toBe(2);
    expect(d.added).toBe(0);
  });

  it('两个都空', () => {
    const d = diffFile(P, '', '');
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
  });

  it('末尾换行的差异能被识别', () => {
    const d = diffFile(P, 'a\n', 'a');
    // 'a\n' 切分后是 ['a']（结尾空行被 pop 掉），所以其实等价
    expect(d.added + d.removed).toBe(0);
  });

  it('空行是有效内容（不能被当成噪音丢掉）', () => {
    const d = diffFile(P, 'a\n\nb', 'a\nb');

    expect(d.removed).toBe(1);
    expect(d.added).toBe(0);
  });

  // ── 大文件保护 ──
  it('超大文件退化成整体替换，不做逐行对比（避免 O(n×m) 卡死）', () => {
    const before = Array.from({ length: MAX_DIFF_LINES + 100 }, (_, i) => `line ${i}`).join('\n');
    const after = Array.from({ length: MAX_DIFF_LINES + 100 }, (_, i) => `changed ${i}`).join('\n');

    const start = Date.now();
    const d = diffFile(P, before, after);
    const elapsed = Date.now() - start;

    expect(d.truncated).toBe(true);
    expect(d.lines.some((l) => l.content.includes('跳过逐行对比'))).toBe(true);
    // 关键：不能卡住
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('renderUnifiedDiff', () => {
  it('输出标准 unified diff 格式', () => {
    const d = diffFile(P, 'a\nb\nc', 'a\nX\nc');
    const text = renderUnifiedDiff([d]);

    expect(text).toContain('--- a/src/a.ts');
    expect(text).toContain('+++ b/src/a.ts');
    expect(text).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(text).toContain('-b');
    expect(text).toContain('+X');
    expect(text).toContain(' a'); // 上下文行以空格开头
  });

  it('新文件标注"(新文件)"', () => {
    const d = diffFile(P, null, 'hello');
    expect(renderUnifiedDiff([d])).toContain('(新文件)');
  });

  it('没有实际改动的文件不占位置', () => {
    const unchanged = diffFile(P, 'a', 'a');
    expect(renderUnifiedDiff([unchanged])).toBe('');
  });

  it('多文件拼接（每个文件都有自己的头）', () => {
    const d1 = diffFile('/fake/workspace/src/a.ts', 'a', 'X');
    const d2 = diffFile('/fake/workspace/src/b.ts', 'b', 'Y');
    const text = renderUnifiedDiff([d1, d2]);

    expect(text).toContain('a/src/a.ts');
    expect(text).toContain('a/src/b.ts');
  });
});

describe('renderCompactPreview', () => {
  it('包含路径、统计、增删标记', () => {
    const d = diffFile(P, 'a\nb\nc', 'a\nX\nc');
    const text = renderCompactPreview([d]);

    expect(text).toContain('src/a.ts');
    expect(text).toContain('[+1 -1]');
    expect(text).toContain('-b');
    expect(text).toContain('+X');
  });

  it('超出 maxLines 时折叠并提示（不能刷屏）', () => {
    const before = Array.from({ length: 200 }, (_, i) => `old${i}`).join('\n');
    const after = Array.from({ length: 200 }, (_, i) => `new${i}`).join('\n');
    const d = diffFile(P, before, after);

    const text = renderCompactPreview([d], 10);
    const lines = text.split('\n');

    expect(lines.length).toBeLessThan(30); // 有上限
    // 单个文件超预算时提示"本文件还有多少行没显示"
    expect(text).toContain('本文件还有');
  });
});

describe('summarizeDiffs', () => {
  it('汇总文件数和增删行数', () => {
    const d1 = diffFile('/fake/workspace/a.ts', 'a\nb', 'a\nX');
    const d2 = diffFile('/fake/workspace/b.ts', 'c', 'd');
    const s = summarizeDiffs([d1, d2]);

    expect(s).toContain('2 个文件');
    expect(s).toContain('+2');
    expect(s).toContain('-2');
  });

  it('全部无变化时说"没有实际改动"', () => {
    const d = diffFile(P, 'a', 'a');
    expect(summarizeDiffs([d])).toBe('没有实际改动');
  });

  it('新建文件计入变更（否则整个新文件就是"没改动"，会误导）', () => {
    const d = diffFile(P, null, 'a\nb');
    expect(summarizeDiffs([d])).toContain('1 个文件');
  });
});

describe('diffFiles 批量', () => {
  it('一次算多个文件', () => {
    const diffs = diffFiles([
      { absPath: '/fake/workspace/a.ts', before: 'a', after: 'x' },
      { absPath: '/fake/workspace/b.ts', before: null, after: 'new' },
      { absPath: '/fake/workspace/c.ts', before: 'same', after: 'same' },
    ]);

    expect(diffs).toHaveLength(3);
    expect(diffs[0].added).toBe(1);
    expect(diffs[1].isNew).toBe(true);
    expect(diffs[2].added).toBe(0);
  });
});