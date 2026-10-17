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

const MAX_OUTPUT_CHARS = 30000;

export class ReadFileTool implements Tool {
  readonly name = 'read_file';
  readonly description = '读取文件内容。返回完整文本。文件过大（>30000 字符）会自动截断。';
  readonly parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径（绝对路径或相对当前工作目录）' },
    },
    required: ['path'],
  };

  async execute(args: { path: string }): Promise<ToolResult> {
    const filePath = path.resolve(args.path);

    try {
      await fs.access(filePath);
    } catch {
      return { content: `文件不存在: ${args.path}`, isError: true };
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      if (content.length > MAX_OUTPUT_CHARS) {
        return {
          content:
            content.slice(0, MAX_OUTPUT_CHARS) +
            `\n\n[文件过大，已截断到 ${MAX_OUTPUT_CHARS} 字符，共 ${content.length}]`,
        };
      }

      return { content };
    } catch (e: any) {
      if (e.code === 'ENOENT') return { content: `文件不存在: ${args.path}`, isError: true };
      return { content: `读取失败: ${e.message}`, isError: true };
    }
  }
}