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
import { writeMeta } from './meta';
import { snapshotOperation, discardCheckpoint } from '../checkpoint/store';

export class WriteFileTool implements Tool {
  readonly name = 'write_file';
  readonly meta = writeMeta();
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

    // ⭐ 先读原内容存快照。
    //   - 文件已存在 → 存原内容，/undo 时写回去
    //   - 文件是新建的 → 存 null，/undo 时把这个文件删掉
    //   两种情况都必须存：新建的文件同样需要"撤销"，
    //   否则 agent 建了一堆垃圾文件用户没法一键清掉。
    const before = exists ? await fs.readFile(filePath, 'utf-8').catch(() => null) : null;
    const cpId = snapshotOperation(this.name, [{ absPath: filePath, before }]);

    if (exists) {
      const approved = await requireWriteApproval(
        this.name,
        `将【覆盖】已存在的文件 ${toWorkspaceRelative(filePath)}\n` +
          `原内容会被完全替换，只保留你传入的 content。`,
      );
      if (!approved) {
        if (cpId) discardCheckpoint(cpId);
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
          (exists ? '（覆盖了原有内容）' : '（新建文件）') +
          (cpId
            ? `\n💡 本次改动已存档（${cpId}）。改错了可以用 /undo 退回，或调用 restore_file。`
            : ''),
      };
    } catch (e: any) {
      if (cpId) discardCheckpoint(cpId);
      return { content: `写入失败: ${e.message}`, isError: true };
    }
  }
}