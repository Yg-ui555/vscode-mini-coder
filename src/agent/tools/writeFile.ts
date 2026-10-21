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
import { resolveInWorkspace, toWorkspaceRelative } from './paths';
import { requireWriteApproval } from './approval';

export class WriteFileTool implements Tool {
  readonly name = 'write_file';
  readonly description =
    '写入文件内容（覆盖整个文件）。仅用于创建新文件；修改已有文件请优先用 apply_patch。' +
    '路径必须在当前工作区内。';
  readonly parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径（必须在工作区内）' },
      content: { type: 'string', description: '文件内容' },
    },
    required: ['path', 'content'],
  };

  async execute(args: { path: string; content: string }): Promise<ToolResult> {
    // 路径白名单
    const guard = resolveInWorkspace(args.path);
    if (!guard.ok) {
      return { content: guard.error!, isError: true };
    }
    const filePath = guard.resolved;

    // 覆盖已有文件是高风险操作（整个内容被替换），单独确认
    const exists = await fs.stat(filePath).then((s) => s.isFile()).catch(() => false);
    if (exists) {
      const approved = await requireWriteApproval(
        this.name,
        `将【覆盖】已存在的文件 ${toWorkspaceRelative(filePath)}\n` +
          `原内容会被完全替换，只保留你传入的 content。`,
      );
      if (!approved) {
        return { content: '用户拒绝了覆盖操作。请改用 apply_patch 做局部修改。', isError: true };
      }
    }

    try {
      // 自动创建父目录
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, args.content, 'utf-8');
      return {
        content:
          `已写入 ${args.content.length} 字符到 ${toWorkspaceRelative(filePath)}` +
          (exists ? '（覆盖了原有内容）' : '（新建文件）'),
      };
    } catch (e: any) {
      return { content: `写入失败: ${e.message}`, isError: true };
    }
  }
}