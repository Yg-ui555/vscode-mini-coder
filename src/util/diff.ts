/**
 * 统一 diff 生成（unified diff）
 *
 * ─────────────────────────────────────────────────────────────
 * 这个模块要解决的用户痛点
 * ─────────────────────────────────────────────────────────────
 *
 *   现在用户点"允许"之前，只能看到一句"将修改 3 个文件：src/a.ts …"。
 *   他不知道 AI 到底要把哪一行改成哪一行。
 *
 *   于是每个用户被迫在两种糟糕之间选：
 *     · 闭眼点允许 → 改完发现不对，Ctrl+Z 一次次盲退
 *     · 每次都拒绝 → agent 什么都干不成
 *
 *   本项目已经有【事后回滚】（checkpoint + /undo，这是领先 goose/nanobot 的地方），
 *   但事后补救不能替代事前知情。
 *   预览 + 回滚凑齐，才是完整的"敢放手让它改"。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么不引第三方 diff 库
 * ─────────────────────────────────────────────────────────────
 *
 *   `diff` 这个 npm 包很小很成熟，但引入它会带来两个代价：
 *     · 破坏"零运行时依赖"（目前整个扩展除了 VS Code 自身不需要任何包）
 *     · 它按行/按字符切分的策略我们要控制，因为【生成结果是要给人看的】，
 *       不是给 git 用的 —— 策略不合适会让人根本读不懂改动
 *
 *   而我们要的 diff 只有两个用途：
 *     1. 弹窗里显示统计（+12 -3）
 *     2. 打开一个只读文档让人通读全文
 *   都是"给人看"，标准 unified diff 的 @@ hunk 头其实还有点噪音，
 *   但它是通用格式、可读性够用，而且模型也认得。
 *
 * ─────────────────────────────────────────────────────────────
 * 算法：最长公共子序列（LCS）
 * ─────────────────────────────────────────────────────────────
 *
 *   教科书做法是 O(n×m) 的 DP 表。对源码文件来说：
 *     2000 行 × 2000 行 = 400 万个格子 → 内存和时间都不可接受
 *
 *   所以加了保护：
 *     · 行数超过 MAX_DIFF_LINES 直接退化成"整块替换"，不做逐行对比
 *       （反正人眼也读不出 2000 行的逐行 diff，看统计就够了）
 *     · DP 表用一维滚动数组，把内存从 O(n×m) 降到 O(m)
 *
 *   这个取舍的理由：diff 是给人做判断依据的，不是用来做代码审查的。
 *   一个读不动的 diff 不如没有 diff。
 */

import * as path from 'path';
import { toWorkspaceRelative } from '../agent/tools/paths';

/** 超过这个行数就退化成整体替换，不做逐行 diff */
export const MAX_DIFF_LINES = 2000;

/** 上下文行数（标准 unified diff 用 3） */
const CONTEXT_LINES = 3;

export type DiffOp = 'eq' | 'del' | 'add';

export interface DiffLine {
  op: DiffOp;
  content: string;
  /** 该行在原文件中的行号（1-based，add 行为 null） */
  oldLine: number | null;
  /** 该行在新文件中的行号（1-based，del 行为 null） */
  newLine: number | null;
}

export interface FileDiff {
  /** 相对工作区的路径 */
  path: string;
  /** 是否是新建文件 */
  isNew: boolean;
  /** 是否是删除文件 */
  isDeleted: boolean;
  lines: DiffLine[];
  added: number;
  removed: number;
  /** 因文件过大而跳过了逐行对比 */
  truncated: boolean;
}

/**
 * 算相对工作区的展示路径
 *
 * ⭐ 强制正斜杠：Windows 上 toWorkspaceRelative 返回的是反斜杠
 *   （src\a.ts），而这份 diff 有三个读者：
 *     · 用户（在通知弹窗 / diff 文档里看）
 *     · 模型（读 tool_result 里的 diff，判断自己改了什么）
 *     · 将来可能的导出（贴到 issue / PR 里）
 *   正斜杠在这三个场景下都成立，反斜杠在第 3 个场景会被 markdown 转义。
 */
function displayPath(absPath: string): string {
  return toWorkspaceRelative(absPath).split(path.sep).join('/');
}

/**
 * 生成单文件的 unified diff
 *
 * @param before 修改前内容；null 表示"文件原本不存在"
 * @param after  修改后内容；null 表示"文件被删除"
 */
export function diffFile(
  absPath: string,
  before: string | null,
  after: string | null,
): FileDiff {
  const relPath = displayPath(absPath);
  const isNew = before === null;
  const isDeleted = after === null;

  if (isNew) {
    const content = after ?? '';
    const arr = splitLines(content);
    return {
      path: relPath,
      isNew: true,
      isDeleted: false,
      lines: arr.map((c, i) => ({ op: 'add' as const, content: c, oldLine: null, newLine: i + 1 })),
      added: arr.length,
      removed: 0,
      truncated: false,
    };
  }

  if (isDeleted) {
    const arr = splitLines(before ?? '');
    return {
      path: relPath,
      isNew: false,
      isDeleted: true,
      lines: arr.map((c, i) => ({ op: 'del' as const, content: c, oldLine: i + 1, newLine: null })),
      added: 0,
      removed: arr.length,
      truncated: false,
    };
  }

  const oldLines = splitLines(before!);
  const newLines = splitLines(after!);

  // 相同内容直接返回空 diff（省掉一大段无意义的 @@ 噪音）
  if (before === after) {
    return {
      path: relPath,
      isNew: false,
      isDeleted: false,
      lines: [],
      added: 0,
      removed: 0,
      truncated: false,
    };
  }

  // 太大就退化成整体替换
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    const lines: DiffLine[] = [];
    const keepHead = Math.min(oldLines.length, CONTEXT_LINES);
    for (let i = 0; i < keepHead; i++) {
      lines.push({ op: 'eq', content: oldLines[i], oldLine: i + 1, newLine: i + 1 });
    }
    lines.push({
      op: 'eq',
      content: `... 文件过大（${Math.max(oldLines.length, newLines.length)} 行），跳过逐行对比 ...`,
      oldLine: null,
      newLine: null,
    });
    for (let i = 0; i < newLines.length; i++) {
      lines.push({ op: 'add', content: newLines[i], oldLine: null, newLine: oldLines.length + i + 1 });
    }
    return {
      path: relPath,
      isNew: false,
      isDeleted: false,
      lines,
      added: newLines.length,
      removed: oldLines.length,
      truncated: true,
    };
  }

  const ops = lcsDiff(oldLines, newLines);
  const lines = annotate(ops);

  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.op === 'add') added++;
    else if (l.op === 'del') removed++;
  }

  return {
    path: relPath,
    isNew: false,
    isDeleted: false,
    lines,
    added,
    removed,
    truncated: false,
  };
}

/** 批量生成 diff */
export function diffFiles(
  changes: Array<{ absPath: string; before: string | null; after: string | null }>,
): FileDiff[] {
  return changes.map((c) => diffFile(c.absPath, c.before, c.after));
}

/**
 * 渲染成标准 unified diff 文本
 *
 * 格式：
 *   --- a/src/a.ts
 *   +++ b/src/a.ts
 *   @@ -1,5 +1,6 @@
 *    上下文
 *   -删掉的行
 *   +新增的行
 *
 * 用 'a/' 'b/' 前缀是 git 的惯例，模型和人都认得。
 */
export function renderUnifiedDiff(diffs: FileDiff[]): string {
  const out: string[] = [];

  for (const d of diffs) {
    // 完全没变化的文件不占地方
    if (d.lines.length === 0 && !d.isNew && !d.isDeleted) continue;

    out.push(`--- a/${d.path}${d.isNew ? ' (新文件)' : ''}`);
    out.push(`+++ b/${d.path}${d.isDeleted ? ' (已删除)' : ''}`);

    if (d.truncated) {
      out.push('@@ 文件过大，已折叠为整体替换 @@');
      for (const l of d.lines) out.push(formatLine(l));
      continue;
    }

    // 按 hunk 分组：变更处前后各保留 CONTEXT_LINES 行上下文
    for (const hunk of buildHunks(d.lines)) {
      out.push(
        `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
      );
      for (const l of hunk.lines) out.push(formatLine(l));
    }
  }

  return out.join('\n');
}

/** 单行格式化：eq 留一个空格，del/add 用标准前缀 */
function formatLine(l: DiffLine): string {
  if (l.content.startsWith('@@ 文件过大')) return ` ${l.content}`;
  if (l.op === 'add') return `+${l.content}`;
  if (l.op === 'del') return `-${l.content}`;
  return ` ${l.content}`;
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

/** 把 diff 行按"变更块 + 上下文"分组 */
function buildHunks(lines: DiffLine[]): Hunk[] {
  const hunks: Hunk[] = [];
  let i = 0;

  while (i < lines.length) {
    // 跳过未变更的连续区域（留 CONTEXT_LINES 行上下文）
    if (lines[i].op === 'eq') {
      i++;
      continue;
    }

    // 回退到变更前 CONTEXT_LINES 行
    const start = Math.max(0, i - CONTEXT_LINES);
    // 向前延伸到最后一个变更行
    let lastChange = i;
    let j = i;
    while (j < lines.length) {
      if (lines[j].op !== 'eq') lastChange = j;
      // 连续 CONTEXT_LINES 行未变更就说明 hunk 结束
      if (
        j > lastChange &&
        j - lastChange > CONTEXT_LINES &&
        lines[j].op === 'eq'
      ) {
        break;
      }
      j++;
    }

    const end = Math.min(lines.length, lastChange + CONTEXT_LINES + 1);
    const slice = lines.slice(start, end);

    const oldNums = slice.filter((l) => l.oldLine !== null).map((l) => l.oldLine!);
    const newNums = slice.filter((l) => l.newLine !== null).map((l) => l.newLine!);

    hunks.push({
      oldStart: oldNums.length ? oldNums[0] : 0,
      oldCount: oldNums.length,
      newStart: newNums.length ? newNums[0] : 0,
      newCount: newNums.length,
      lines: slice,
    });

    i = end;
  }

  return hunks;
}

/**
 * 渲染成"给人看"的紧凑预览（不是给 git 用的）
 *
 * 用于审批弹窗：只显示变更行 + 少量上下文，去掉 @@ 头和头尾索引。
 * 为什么单独做一份：用户要的是"哪行变了"，不是"这个文件从第几行到第几行"。
 */
export function renderCompactPreview(diffs: FileDiff[], maxLines = 60): string {
  const out: string[] = [];
  let budget = maxLines;

  for (const d of diffs) {
    if (budget <= 0) {
      out.push('... （改动较多，已折叠。点"查看完整改动"看全文）');
      break;
    }
    if (d.lines.length === 0 && !d.isNew && !d.isDeleted) continue;

    out.push(`── ${d.path}${d.isNew ? '（新建）' : ''} [+${d.added} -${d.removed}] ──`);

    // 只取变更行附近的上下文
    const interesting: DiffLine[] = [];
    for (let i = 0; i < d.lines.length; i++) {
      if (d.lines[i].op === 'eq') {
        // 上下文行只在紧邻变更时保留
        const nearChange =
          d.lines[i - 1]?.op !== 'eq' || d.lines[i + 1]?.op !== 'eq';
        if (nearChange) interesting.push(d.lines[i]);
        continue;
      }
      interesting.push(d.lines[i]);
    }

    const slice = interesting.slice(0, budget);
    for (const l of slice) {
      if (l.content.startsWith('@@ 文件过大')) {
        out.push(`  ${l.content}`);
        continue;
      }
      const prefix = l.op === 'add' ? '+' : l.op === 'del' ? '-' : '  ';
      out.push(`  ${prefix}${l.content}`);
    }
    if (interesting.length > slice.length) {
      out.push(`  ... （本文件还有 ${interesting.length - slice.length} 行差异）`);
    }
    budget -= slice.length;
  }

  return out.join('\n');
}

/** 一句话统计，给弹窗标题用 */
export function summarizeDiffs(diffs: FileDiff[]): string {
  const changed = diffs.filter((d) => d.added > 0 || d.removed > 0 || d.isNew || d.isDeleted);
  if (changed.length === 0) return '没有实际改动';

  let added = 0;
  let removed = 0;
  for (const d of changed) {
    added += d.added;
    removed += d.removed;
  }
  const files = changed.length;
  return `${files} 个文件，+${added} -${removed} 行`;
}

// ══════════════════════════════════════════════════════════════
// 内部实现
// ══════════════════════════════════════════════════════════════

/** 按行切分，保留空行（空行在 diff 里是有意义的信息） */
function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  // 结尾的换行不算一行内容
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

type Op = { op: DiffOp; content: string };

/**
 * LCS 行级 diff
 *
 * 用一维滚动数组做 DP，内存 O(min(n,m))。
 * 逐行回溯需要完整矩阵，所以对超大输入退化成整体替换
 * （见 diffFile 里的 MAX_DIFF_LINES 判断）。
 */
function lcsDiff(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;

  // 完全没变化
  if (n === 0) return b.map((content) => ({ op: 'add' as const, content }));
  if (m === 0) return a.map((content) => ({ op: 'del' as const, content }));

  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // 回溯生成操作序列
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: 'eq', content: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ op: 'del', content: a[i] });
      i++;
    } else {
      ops.push({ op: 'add', content: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ op: 'del', content: a[i++] });
  while (j < m) ops.push({ op: 'add', content: b[j++] });

  return ops;
}

/** 给操作序列标注行号 */
function annotate(ops: Op[]): DiffLine[] {
  let oldLine = 1;
  let newLine = 1;
  const out: DiffLine[] = [];

  for (const o of ops) {
    if (o.op === 'eq') {
      out.push({ op: 'eq', content: o.content, oldLine: oldLine++, newLine: newLine++ });
    } else if (o.op === 'del') {
      out.push({ op: 'del', content: o.content, oldLine: oldLine++, newLine: null });
    } else {
      out.push({ op: 'add', content: o.content, oldLine: null, newLine: newLine++ });
    }
  }

  return out;
}