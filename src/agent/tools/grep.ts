/**
 * grep 工具 —— 按【内容】搜索文件
 *
 * 类比：Windows 记事本里的「查找全部」，只不过这里能一次搜整个项目。
 *
 * ⭐ 为什么这是最重要的一个补充工具：
 *   在它出现之前，agent 想找「哪里调用了这个函数」只能走 run_shell 跑
 *   grep -rn。后果有三：
 *     1. 触发危险命令确认弹窗（每次都要多点一次）
 *     2. 结果是一坨没结构的文本，LLM 很难稳定解析
 *     3. 评测集里 11-14 这类"跨文件一致性改动"题根本没法做 ——
 *        它不是模型不会，是工具压根没给
 *
 *   有了它，"改一个函数所有调用点"这种最常见的真实任务才成为可能。
 *
 * 为什么不用系统 ripgrep（rg）：
 *   nanobot 的 tools/rg.py 是「装了 rg 就用 rg，没装就降级」。这里选择
 *   纯 JS 实现，理由：
 *     - 输出格式完全可控，跨平台（Windows/Linux/macOS）表现一致
 *     - 同步可测，能直接写单测；spawn rg 的路径很难测
 *     - 配合 IGNORED_DIRS + 扫描上限，典型项目 2000 个文件 < 1 秒
 *   真遇到超大仓库（10 万文件）再换 rg，届时只需替换 walkSearch 内部实现，
 *   对外接口不变。
 */

import * as fs from 'fs';
import * as path from 'path';
import { Tool, ToolResult } from './base';
import { resolveInWorkspace, getDefaultCwd } from './paths';
import { readOnlyMeta } from './meta';
import {
  walkFiles,
  readTextSafe,
  isBinaryPath,
  globToRegExp,
  makeDescendPredicate,
} from './fileScan';

/** 默认最多返回多少条匹配（超了截断，防止撑爆上下文） */
const DEFAULT_MAX_RESULTS = 100;
const HARD_MAX_RESULTS = 300;
/** 每行内容最多显示多少字符 */
const MAX_LINE_CHARS = 300;

export class GrepTool implements Tool {
  readonly name = 'grep';
  readonly meta = readOnlyMeta();
  readonly description =
    '按内容搜索文件，返回 `文件:行号:内容` 形式的匹配列表。\n' +
    '支持正则表达式（PCRE/JavaScript 语法）。支持用 glob 限定文件范围，' +
    '例如 glob="src/**/*.ts" 只搜 TypeScript 源码。\n' +
    '会自动跳过 node_modules/.git/dist 等目录，二进制文件自动忽略。\n' +
    '⚠️ 默认会搜整个工作区；搜不到时请确认路径是否正确。';
  readonly parameters = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: '要搜索的正则表达式，例如 "export class .*Tool" 或 "TODO|FIXME"',
      },
      path: {
        type: 'string',
        description: '限定搜索的目录或文件路径（必须在工作区内）。留空表示搜整个工作区。',
      },
      glob: {
        type: 'string',
        description: '文件路径匹配模式，限定搜索范围。例如 "src/**/*.ts"、"*.md"。留空表示不限。',
      },
      caseSensitive: {
        type: 'boolean',
        description: '是否区分大小写，默认 false',
      },
      maxResults: {
        type: 'integer',
        description: `最多返回多少条匹配（默认 ${DEFAULT_MAX_RESULTS}，上限 ${HARD_MAX_RESULTS}）`,
      },
    },
    required: ['pattern'],
  };

  async execute(args: {
    pattern: string;
    path?: string;
    glob?: string;
    caseSensitive?: boolean;
    maxResults?: number;
  }): Promise<ToolResult> {
    const { pattern } = args;
    if (!pattern || typeof pattern !== 'string') {
      return { content: 'grep 需要 pattern 参数（要搜索的正则表达式）', isError: true };
    }

    // 1. 编译正则。LLM 经常写出非法正则，这里给可操作的错误提示而不是崩溃。
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, args.caseSensitive ? 'g' : 'gi');
    } catch (e: any) {
      return {
        content:
          `正则表达式无效: ${pattern}\n错误: ${e?.message || e}\n` +
          `请检查括号是否配对、转义是否正确。特殊字符需要转义，例如 . * + ? 需要写成 \\. \\* \\+ \\?`,
        isError: true,
      };
    }

    // 2. 确定搜索根目录（必须过工作区白名单）
    let root: string;
    if (args.path) {
      const guard = resolveInWorkspace(args.path);
      if (!guard.ok) return { content: guard.error!, isError: true };
      root = guard.resolved;
    } else {
      root = getDefaultCwd();
    }

    // 3. 文件名过滤器
    let nameFilter: RegExp | undefined;
    if (args.glob) {
      try {
        nameFilter = globToRegExp(args.glob);
      } catch {
        return { content: `glob 模式无效: ${args.glob}`, isError: true };
      }
    }

    // 4. 遍历 + 搜索
    const limit = Math.min(args.maxResults ?? DEFAULT_MAX_RESULTS, HARD_MAX_RESULTS);
    const descend = nameFilter ? makeDescendPredicate(args.glob) : undefined;

    const { files, truncated: scanTruncated, reason } = walkFiles({
      root,
      shouldDescend: descend,
    });

    // 根目录本身就是文件的情况
    let targetFiles = files;
    if (targetFiles.length === 0) {
      if (fs.existsSync(root) && fs.statSync(root).isFile()) {
        targetFiles = [{ abs: root, rel: path.basename(root) }];
      }
    }

    const matches: string[] = [];
    const matchedFiles = new Set<string>();
    let scannedCount = 0;

    for (const f of targetFiles) {
      if (matches.length >= limit) break;

      if (nameFilter && !nameFilter.test(f.rel)) continue;
      if (isBinaryPath(f.abs)) continue;

      const content = readTextSafe(f.abs);
      if (content === null) continue;
      scannedCount++;

      // 按行扫描：匹配的行号对 LLM 最有价值（它要拿着行号去 read_file）
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (!regex.test(lines[i])) continue;

        matchedFiles.add(f.rel);
        if (matches.length < limit) {
          const lineText = lines[i].length > MAX_LINE_CHARS
            ? lines[i].slice(0, MAX_LINE_CHARS) + '…'
            : lines[i];
          matches.push(`${f.rel}:${i + 1}:${lineText.trim()}`);
        }
        if (matches.length >= limit) break;
      }
    }

    // 5. 组装输出
    const scopeNote = args.path ? `目录 ${args.path}` : '整个工作区';
    const globNote = args.glob ? `，文件名匹配 ${args.glob}` : '';

    if (matches.length === 0) {
      let msg =
        `在${scopeNote}${globNote}里没有找到匹配「${pattern}」的内容。\n` +
        `（已扫描 ${scannedCount} 个文件）\n` +
        `\n可能原因：\n` +
        `1. 关键词不对 —— 试试更短的词，或换同义词\n` +
        `2. 范围不对 —— 用 glob 放宽限制，比如 glob="**/*.ts"\n` +
        `3. 用了 list_dir / glob 确认一下文件真的存在`;
      if (scanTruncated) msg += `\n⚠️ ${reason}，结果可能不完整。`;
      return { content: msg };
    }

    let header =
      `在${scopeNote}${globNote}里找到 ${matches.length}${matches.length >= limit ? '+' : ''} 处匹配` +
      `（分布在 ${matchedFiles.size} 个文件，已扫描 ${scannedCount} 个文件）：\n\n`;

    let footer = '';
    if (matches.length >= limit) {
      footer =
        `\n\n[已截断：最多显示 ${limit} 条。` +
        `请用更精确的 pattern 或加 path/glob 缩小范围后重搜。]`;
    }
    if (scanTruncated) {
      footer += `\n[⚠️ 扫描不完整：${reason}。结果可能遗漏文件。]`;
    }

    footer +=
      `\n\n下一步：用 read_file 配合上面的 行号 读取上下文，` +
      `或用 apply_patch 修改。`;

    return { content: header + matches.join('\n') + footer };
  }
}
