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
import { resolveInWorkspace, toWorkspaceRelative } from './paths';
import { readOnlyMeta } from './meta';
import {
  hashContent,
  checkRepeatRead,
  recordRepeatRead,
} from './repeatGuard';

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

      // ⭐ 重复读取检测（2026-10-24）
      //
      //   为什么在这里（读完文件之后）而不是之前：
      //     要判断"文件有没有变"，必须先读到当前内容才能算 hash。
      //     所以顺序是：读 → 算 hash → 查回执 → 命中就返回提示，不重复返回内容。
      //
      //   为什么返回的是提示而不是错误：
      //     工具"失败"时 LLM 倾向于原样重试或换工具硬来；
      //     工具"成功但没给新信息"时 LLM 才会停下来用之前的结果。
      //     详见 repeatGuard.ts 顶部的说明。
      //
      //   ⚠️ 这里只拦截"完全相同参数 + 文件内容没变"的情况：
      //     · 换个 offset/limit 读 → 不算重复（那是真的要看别的地方）
      //     · 文件被改过 → 不算重复（那是真的需要重读）
      const contentHash = hashContent(content);
      const repeatHint = checkRepeatRead(filePath, args.offset, args.limit, contentHash);
      if (repeatHint) {
        return { content: repeatHint };
      }

      // 分段读取（抄 goose 的 apply_line_limit：避免一次吃掉整个大文件）
      if (args.offset || args.limit) {
        const lines = content.split('\n');
        const start = Math.max(0, (args.offset ?? 1) - 1); // 对 LLM 来说 1-based 更自然
        const end = args.limit ? start + args.limit : lines.length;
        content = lines.slice(start, end).join('\n');
        const result =
          `第 ${start + 1}-${end} 行（共 ${lines.length} 行）:\n${content}` +
          (end < lines.length ? `\n\n[还有 ${lines.length - end} 行没读，可用 offset=${end + 1} 继续]` : '');
        recordRepeatRead(
          filePath,
          args.offset,
          args.limit,
          contentHash,
          hashContent(result),
        );
        return { content: result };
      }

      if (content.length > MAX_OUTPUT_CHARS) {
        const truncated = content.slice(0, MAX_OUTPUT_CHARS);
        const totalLines = content.split('\n').length;
        const shownLines = truncated.split('\n').length;
        const result =
          `${truncated}\n\n` +
          `[文件过大，已截断：显示前 ${MAX_OUTPUT_CHARS} 字符（约 ${shownLines}/${totalLines} 行），` +
          `完整内容共 ${content.length} 字符。\n` +
          `⚠ 报错信息通常在文件末尾，建议用 offset=${shownLines + 1} 读取剩余部分。]`;
        recordRepeatRead(
          filePath,
          args.offset,
          args.limit,
          contentHash,
          hashContent(result),
        );
        return { content: result };
      }

      recordRepeatRead(
        filePath,
        args.offset,
        args.limit,
        contentHash,
        hashContent(content),
      );
      return { content };
    } catch (e: any) {
      if (e.code === 'ENOENT') return { content: `文件不存在: ${args.path}`, isError: true };
      if (e.code === 'EISDIR') return { content: `${args.path} 是目录，请指定具体文件`, isError: true };
      return { content: `读取失败: ${e.message}`, isError: true };
    }
  }
}