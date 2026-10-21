/**
 * read_file 工具
 *
 * 关键设计：
 * - 限制输出大小（30000 字符），防 LLM 上下文爆炸
 * - 二进制文件检测（不抛异常但返回错误）
 * - 相对路径自动从 cwd 解析
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Tool, ToolResult } from './base';
import { resolveInWorkspace } from './paths';
import { readOnlyMeta } from './meta';

const MAX_OUTPUT_CHARS = 30000;

export class ReadFileTool implements Tool {
  readonly name = 'read_file';
  readonly meta = readOnlyMeta();
  readonly description =
    '读取文件内容。返回文本。文件过大（>30000 字符）会截断，' +
    '截断时会在末尾提示完整长度——此时请用 offset/limit 分段读取。' +
    '路径必须在当前工作区内。';
  readonly parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径（必须在工作区内）' },
      offset: { type: 'integer', description: '从第几行开始读（可选，配合大文件分段）' },
      limit: { type: 'integer', description: '最多读多少行（可选，默认全部）' },
    },
    required: ['path'],
  };

  async execute(args: { path: string; offset?: number; limit?: number }): Promise<ToolResult> {
    // 路径白名单（读也要拦，防止 LLM 探测系统文件）
    const guard = resolveInWorkspace(args.path);
    if (!guard.ok) {
      return { content: guard.error!, isError: true };
    }
    const filePath = guard.resolved;

    try {
      await fs.access(filePath);
    } catch {
      return { content: `文件不存在: ${args.path}`, isError: true };
    }

    try {
      let content = await fs.readFile(filePath, 'utf-8');

      // 分段读取（抄 goose 的 apply_line_limit：避免一次吃掉整个大文件）
      if (args.offset || args.limit) {
        const lines = content.split('\n');
        const start = Math.max(0, (args.offset ?? 1) - 1); // 对 LLM 来说 1-based 更自然
        const end = args.limit ? start + args.limit : lines.length;
        content = lines.slice(start, end).join('\n');
        return {
          content:
            `第 ${start + 1}-${end} 行（共 ${lines.length} 行）:\n${content}` +
            (end < lines.length ? `\n\n[还有 ${lines.length - end} 行没读，可用 offset=${end + 1} 继续]` : ''),
        };
      }

      if (content.length > MAX_OUTPUT_CHARS) {
        const truncated = content.slice(0, MAX_OUTPUT_CHARS);
        const totalLines = content.split('\n').length;
        const shownLines = truncated.split('\n').length;
        return {
          content:
            `${truncated}\n\n` +
            `[文件过大，已截断：显示前 ${MAX_OUTPUT_CHARS} 字符（约 ${shownLines}/${totalLines} 行），` +
            `完整内容共 ${content.length} 字符。\n` +
            `⚠ 报错信息通常在文件末尾，建议用 offset=${shownLines + 1} 读取剩余部分。]`,
        };
      }

      return { content };
    } catch (e: any) {
      if (e.code === 'ENOENT') return { content: `文件不存在: ${args.path}`, isError: true };
      if (e.code === 'EISDIR') return { content: `${args.path} 是目录，请指定具体文件`, isError: true };
      return { content: `读取失败: ${e.message}`, isError: true };
    }
  }
}