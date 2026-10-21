/**
 * glob 工具 —— 按【文件名模式】找文件
 *
 * 类比：在资源管理器地址栏输入 `*.ts` 搜索。
 *
 * 它解决的问题：agent 需要知道「这个项目有哪些测试文件」「配置文件在哪」
 * 「所有的 TypeScript 源文件有哪些」。没有它，agent 只能一个个 read_file 试，
 * 非常低效。
 *
 * 与 grep 的分工：
 *   glob  = 按【文件名】找（"所有叫 *.test.ts 的文件"）
 *   grep  = 按【文件内容】找（"所有出现过 TODO 的地方"）
 *   两者可组合：glob 先缩小范围，grep 再搜内容
 */

import * as fs from 'fs';
import * as path from 'path';
import { Tool, ToolResult } from './base';
import { resolveInWorkspace, getDefaultCwd } from './paths';
import { walkFiles, globToRegExp, makeDescendPredicate, isBinaryPath } from './fileScan';
import { readOnlyMeta } from './meta';

const DEFAULT_MAX_RESULTS = 200;
const HARD_MAX_RESULTS = 1000;

export class GlobTool implements Tool {
  readonly name = 'glob';
  readonly meta = readOnlyMeta();
  readonly description =
    '按文件名模式查找文件，返回匹配的文件列表（按修改时间倒序，最近改的在前）。\n' +
    '支持语法：** 跨任意层目录，* 单层任意字符，? 单个字符，{a,b} 或或。\n' +
    '例：glob="src/**/*.ts" 找所有 ts；glob="**/*.{test,spec}.ts" 找所有测试文件；glob="**/package.json"。\n' +
    '自动跳过 node_modules/.git/dist 等目录。想按【内容】搜索请用 grep。';
  readonly parameters = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: '文件名匹配模式，例如 "src/**/*.ts"、"**/*.test.ts"、"*.md"',
      },
      path: {
        type: 'string',
        description: '搜索根目录（必须在工作区内）。留空表示整个工作区。',
      },
      maxResults: {
        type: 'integer',
        description: `最多返回多少个（默认 ${DEFAULT_MAX_RESULTS}，上限 ${HARD_MAX_RESULTS}）`,
      },
    },
    required: ['pattern'],
  };

  async execute(args: {
    pattern: string;
    path?: string;
    maxResults?: number;
  }): Promise<ToolResult> {
    const { pattern } = args;
    if (!pattern || typeof pattern !== 'string') {
      return { content: 'glob 需要 pattern 参数（文件名匹配模式）', isError: true };
    }

    let regex: RegExp;
    try {
      regex = globToRegExp(pattern);
    } catch (e: any) {
      return { content: `glob 模式无效: ${pattern}\n错误: ${e?.message || e}`, isError: true };
    }

    let root: string;
    if (args.path) {
      const guard = resolveInWorkspace(args.path);
      if (!guard.ok) return { content: guard.error!, isError: true };
      root = guard.resolved;
    } else {
      root = getDefaultCwd();
    }

    const limit = Math.min(args.maxResults ?? DEFAULT_MAX_RESULTS, HARD_MAX_RESULTS);

    // 用 glob 模式做下潜剪枝：模式限定在 src/ 下时，别去别处空转
    const { files, truncated: scanTruncated, reason } = walkFiles({
      root,
      shouldDescend: makeDescendPredicate(pattern),
    });

    const matched = files
      .filter((f) => regex.test(f.rel))
      .map((f) => {
        let mtime = 0;
        try {
          mtime = fs.statSync(f.abs).mtimeMs;
        } catch {
          /* 文件可能刚被删，忽略 */
        }
        return { rel: f.rel, mtime, binary: isBinaryPath(f.abs) };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (matched.length === 0) {
      let msg =
        `没有文件匹配模式「${pattern}」。\n\n` +
        `请检查：\n` +
        `1. 模式写对了吗？（** 跨目录，* 不跨目录）\n` +
        `2. 用 list_dir 看看目录结构\n` +
        `3. 路径大小写 —— Windows 不区分，Linux 区分`;
      if (scanTruncated) msg += `\n⚠️ ${reason}，结果可能不完整。`;
      return { content: msg };
    }

    const shown = matched.slice(0, limit);
    const lines = shown.map((f) => {
      const tag = f.binary ? ' [二进制]' : '';
      return `  ${f.rel}${tag}`;
    });

    let footer = `\n\n共 ${matched.length} 个文件匹配`;
    if (matched.length > limit) {
      footer += `，已显示前 ${limit} 个。请用更精确的 pattern 收窄。`;
    }
    footer += `。\n下一步：用 read_file 读取需要的文件。`;
    if (scanTruncated) {
      footer += `\n[⚠️ 扫描不完整：${reason}]`;
    }

    return {
      content: `匹配「${pattern}」的文件（按最近修改排序）：\n\n${lines.join('\n')}${footer}`,
    };
  }
}
