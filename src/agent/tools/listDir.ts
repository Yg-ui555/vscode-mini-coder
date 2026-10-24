/**
 * list_dir 工具 —— 列出目录内容
 *
 * 类比：在终端敲 `ls -la`，但结果被整理成了对 LLM 友好的表格。
 *
 * 为什么 agent 需要它：
 *   context.ts 的 system prompt 里写着工作流是
 *     「1. ls 当前项目了解结构 → 2. read 相关文件 → 3. grep 找引用」
 *   但在 glob/grep 出现之前，"ls" 这一步根本没法执行 —— 唯一的办法是
 *   run_shell 跑 ls，会弹危险命令确认。这条工作流是写在 prompt 里骗人的。
 *
 * 设计要点：
 *   - 只列一层，不递归（递归是 glob 的活）
 *   - 子目录优先、文件随后，各自按名称排序 —— 结构稳定，LLM 每次看到的顺序一致
 *   - 大目录截断并提示，避免把 5000 个文件塞进上下文
 */

import * as fs from 'fs';
import * as path from 'path';
import { Tool, ToolResult } from './base';
import { resolveInWorkspace, getDefaultCwd, toWorkspaceRelative } from './paths';
import { isIgnoredDirName, isBinaryPath } from './fileScan';
import { readOnlyMeta } from './meta';

const DEFAULT_MAX_ENTRIES = 200;
const HARD_MAX_ENTRIES = 500;

interface Entry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

export class ListDirTool implements Tool {
  readonly name = 'list_dir';
  readonly meta = readOnlyMeta();
  readonly description =
    '列出目录内容（只列一层，不递归）。返回子目录和文件清单。\n' +
    '子目录名以 / 结尾。不带参数时列出当前工作区根目录。\n' +
    '这是"了解项目结构"的第一步：先 list_dir 看有哪些目录，再逐个进去看。\n' +
    '要递归找文件请用 glob，要按内容搜索请用 grep。';
  readonly parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '要列出的目录（必须在工作区内）。留空表示工作区根目录。',
      },
      maxEntries: {
        type: 'integer',
        description: `最多列出多少项（默认 ${DEFAULT_MAX_ENTRIES}，上限 ${HARD_MAX_ENTRIES}）`,
      },
    },
  };

  async execute(args: { path?: string; maxEntries?: number }): Promise<ToolResult> {
    let dir: string;
    if (args.path) {
      const guard = resolveInWorkspace(args.path);
      if (!guard.ok) return { content: guard.error!, isError: true };
      dir = guard.resolved;
    } else {
      dir = getDefaultCwd();
    }

    let raw: fs.Dirent[];
    try {
      raw = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        return { content: `目录不存在: ${args.path ?? dir}`, isError: true };
      }
      if (e.code === 'ENOTDIR') {
        return {
          content: `${args.path ?? dir} 不是目录。请用 read_file 读文件内容，或用 glob 按文件名找。`,
          isError: true,
        };
      }
      return { content: `读取目录失败: ${e.message}`, isError: true };
    }

    const limit = Math.min(args.maxEntries ?? DEFAULT_MAX_ENTRIES, HARD_MAX_ENTRIES);

    const dirs: Entry[] = [];
    const files: Entry[] = [];
    let ignored = 0;

    for (const d of raw) {
      // 忽略垃圾目录，但告诉用户"这里有 N 个被隐藏的常见目录"
      // ⚠️ 用 isIgnoredDirName 而不是 IGNORED_DIRS.has() ——
      //   后者漏掉 venv311 / venv_old 这类带版本号的虚拟环境目录
      if (d.isDirectory() && isIgnoredDirName(d.name)) {
        ignored++;
        continue;
      }
      let size = 0;
      let mtime = 0;
      try {
        const st = fs.statSync(path.join(dir, d.name));
        size = st.size;
        mtime = st.mtimeMs;
      } catch {
        /* 忽略 */
      }
      if (d.isDirectory()) {
        dirs.push({ name: d.name, isDir: true, size, mtime });
      } else {
        files.push({ name: d.name, isDir: false, size, mtime });
      }
    }

    // 子目录在前（按名），文件在后（按名）—— 结构稳定，LLM 每次看到顺序一致
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    const total = dirs.length + files.length;
    if (total === 0) {
      return {
        content:
          `目录是空的: ${toWorkspaceRelative(dir) || '.'}\n` +
          `（${ignored} 个常见目录如 node_modules 已自动隐藏）`,
      };
    }

    const shownDirs = dirs.slice(0, limit);
    const shownFiles = files.slice(0, Math.max(0, limit - shownDirs.length));

    const lines: string[] = [];

    if (shownDirs.length > 0) {
      lines.push('目录:');
      for (const d of shownDirs) lines.push(`  ${d.name}/`);
      lines.push('');
    }

    if (shownFiles.length > 0) {
      lines.push('文件:');
      for (const f of shownFiles) {
        const tag = isBinaryPath(f.name) ? ' [二进制]' : '';
        lines.push(`  ${f.name}  (${formatSize(f.size)})${tag}`);
      }
    }

    const shown = shownDirs.length + shownFiles.length;
    let footer = `\n共 ${total} 项`;
    if (shown < total) {
      footer += `，已显示前 ${shown} 项。目录内容较多时建议用 glob 精确查找。`;
    }
    if (ignored > 0) {
      footer += `\n（已自动隐藏 ${ignored} 个常见目录，如 node_modules/.git —— 需要看它们请用 glob 显式指定）`;
    }
    footer += `\n下一步：用 glob 找具体文件，或用 list_dir 进入子目录继续了解结构。`;

    return {
      content: `${toWorkspaceRelative(dir) || '.'}/\n\n${lines.join('\n')}${footer}`,
    };
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
