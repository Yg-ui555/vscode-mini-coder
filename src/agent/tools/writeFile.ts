/**
 * write_file 工具
 *
 * 用法：覆盖写整个文件。
 * 一般用 apply_patch 改小块代码，不用这个。
 * 只有创建新文件时才用 write_file。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Tool, ToolResult } from './base';

export class WriteFileTool implements Tool {
  readonly name = 'write_file';
  readonly description = '写入文件内容（覆盖）。仅用于创建新文件，修改已有文件请用 apply_patch。';
  readonly parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
      content: { type: 'string', description: '文件内容' },
    },
    required: ['path', 'content'],
  };

  async execute(args: { path: string; content: string }): Promise<ToolResult> {
    const filePath = path.resolve(args.path);

    try {
      // 自动创建父目录
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, args.content, 'utf-8');
      return { content: `已写入 ${args.content.length} 字符到 ${args.path}` };
    } catch (e: any) {
      return { content: `写入失败: ${e.message}`, isError: true };
    }
  }
}