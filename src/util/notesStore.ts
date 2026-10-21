/**
 * 错题本的纯存储层 —— 不依赖 vscode
 *
 * ⚠️ 为什么必须抽出来（2026-10-21 踩到的坑）
 *
 *   一开始 record_note 工具直接 import features/notes，
 *   而 features/notes 里 `import * as vscode from 'vscode'`。
 *   结果：任何加载工具工厂的地方都会连带把 vscode 拉进来 ——
 *   在 VS Code 之外（评测 CLI、纯 node 脚本、单测）直接
 *   "Cannot find module 'vscode'" 崩掉。
 *
 *   这叫【依赖倒置】：底层（工具层）不该依赖上层（宿主 API）。
 *
 *   所以这里的规则是：**写文件的逻辑必须和"什么时候触发"分离**。
 *   - 本文件：纯 Node，认 workspaceRoot 字符串，谁都能调
 *   - features/notes.ts：只管监听文件、注册命令、提供 UI 交互
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface NoteFileChange {
  /** 文件路径（相对工作区） */
  path: string;
  /** 改了什么，一句话 */
  change: string;
}

export interface NoteEntry {
  /**
   * 'agent' = agent 主动记的富条目（有原因 / 有踩坑 / 有测试结论）
   * 'watch' = 文件保存触发的轻条目（只知道"这个文件变了"）
   */
  kind: 'agent' | 'watch';
  time: string;
  title: string;
  summary?: string;
  files?: NoteFileChange[];
  pitfalls?: string[];
  tests?: string;
}

/** YYYY-MM-DD */
export function todayFileName(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}.md`;
}

export function getNotesDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.notes');
}

/** 渲染一条记录 */
function renderEntry(entry: NoteEntry): string {
  const lines: string[] = [];

  if (entry.kind === 'agent') {
    lines.push(`## ${entry.time} ⭐ ${entry.title}`, '');
    if (entry.summary) lines.push(`${entry.summary}`, '');

    if (entry.files && entry.files.length > 0) {
      lines.push('**改动**：');
      for (const f of entry.files) lines.push(`- \`${f.path}\` — ${f.change}`);
      lines.push('');
    }

    if (entry.pitfalls && entry.pitfalls.length > 0) {
      lines.push('**踩到的坑**：');
      for (const p of entry.pitfalls) lines.push(`- ${p}`);
      lines.push('');
    }

    if (entry.tests) lines.push(`**测试**：${entry.tests}`, '');
  } else {
    // 轻条目只占一行，明确标注是手动修改，不冒充 agent 的总结
    lines.push(`- \`${entry.time}\` ${entry.title}`);
    if (entry.files) {
      for (const f of entry.files) lines.push(`  - \`${f.path}\``);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/** 统计当天条目数 */
async function countEntries(filePath: string): Promise<{ agent: number; watch: number }> {
  let agent = 0;
  let watch = 0;
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      if (line.startsWith('## ') && line.includes('⭐')) agent++;
      else if (line.startsWith('- `') && line.includes('手动修改')) watch++;
    }
  } catch {
    /* 文件不存在 */
  }
  return { agent, watch };
}

/** 更新索引页 */
async function updateIndex(dir: string, dayFile: string): Promise<void> {
  const indexPath = path.join(dir, 'README.md');
  const day = dayFile.slice(0, 10);

  try {
    let content = '';
    try {
      content = await fs.readFile(indexPath, 'utf-8');
    } catch {
      content = '# 错题本索引\n\n按日期归档。点日期可以打开当天的记录。\n';
    }

    // ⭐ 去重必须比对索引里【实际写入的格式】`- [YYYY-MM-DD](YYYY-MM-DD.md)`，
    //    方括号里是【不带 .md 的日期】。
    //    （写成 `[${dayFile}]` 永远匹配不上，会导致同一天每记一次就多一行索引。）
    if (content.includes(`[${day}]`)) return;

    const counts = await countEntries(path.join(dir, dayFile));
    if (!content.endsWith('\n')) content += '\n';
    content += `- [${day}](${dayFile}) — ${counts.agent} 条要点 / ${counts.watch} 次改动\n`;

    await fs.writeFile(indexPath, content, 'utf-8');
  } catch {
    /* 索引写失败不影响主流程 */
  }
}

/**
 * 追加一条记录到今天的错题本
 *
 * @param workspaceRoot 工作区根目录
 * @param entry         记录内容
 * @returns 写入的文件路径；失败返回 null（不抛异常打断主流程）
 */
export async function appendNoteEntry(
  workspaceRoot: string,
  entry: NoteEntry,
): Promise<string | null> {
  if (!workspaceRoot) return null;

  const dir = getNotesDir(workspaceRoot);
  const dayFile = todayFileName();
  const filePath = path.join(dir, dayFile);

  try {
    await fs.mkdir(dir, { recursive: true });

    let existing = '';
    try {
      existing = await fs.readFile(filePath, 'utf-8');
    } catch {
      existing =
        `# ${dayFile.slice(0, 10)} 错题本\n\n` +
        `> 本文件由 Mini-Coder 自动生成，记录当天的改动、原因与踩过的坑。\n` +
        `> 富条目（改动原因 / 踩坑 / 测试结论）由 AI 在任务结束时通过 record_note 写入；\n` +
        `> 轻条目（仅文件变动）由文件保存事件写入。\n\n`;
    }

    await fs.writeFile(filePath, existing + renderEntry(entry), 'utf-8');
    await updateIndex(dir, dayFile);
    return filePath;
  } catch {
    // 写错题本失败绝不能影响用户干活
    return null;
  }
}

/** 读今天的错题本 */
export async function readTodayNote(workspaceRoot: string): Promise<string> {
  if (!workspaceRoot) return '';
  try {
    return await fs.readFile(path.join(getNotesDir(workspaceRoot), todayFileName()), 'utf-8');
  } catch {
    return '';
  }
}

/** 列出所有归档日期（新的在前） */
export async function listNoteDays(workspaceRoot: string): Promise<string[]> {
  if (!workspaceRoot) return [];
  try {
    const files = await fs.readdir(getNotesDir(workspaceRoot));
    return files.filter((f) => f.endsWith('.md') && f !== 'README.md').sort().reverse();
  } catch {
    return [];
  }
}