/**
 * restore_file 工具 —— 让 LLM 自己能把改错的文件退回去
 *
 * 为什么需要"LLM 也能用"这个版本：
 *   人在旁边时可以点 /undo，但很多场景人是没盯着看的：
 *     - 自动修测试跑了一轮，改完发现方向完全错了
 *     - 一轮任务改了 8 个文件，后 4 个是误改
 *   这时候 agent 如果手里有 restore_file，它自己能退回去重做，
 *   而不是硬着头皮在错误的基础上继续改 —— 后者会越改越烂。
 *
 * 借鉴：Claude Code 和 Cline 都有类似的撤销能力；
 *      goose / nanobot 都没有（见 checkpoint/store.ts 里的说明）。
 *
 * 安全约束：
 *   - 路径必须过工作区白名单（和所有写工具一样）
 *   - 只能还原「当前会话」的快照，不能翻别的会话
 *   - 已还原过的快照不能重复还原（否则会覆盖用户之后的修改）
 */

import * as fs from 'fs';
import * as path from 'path';
import { Tool, ToolResult } from './base';
import { resolveInWorkspace, getDefaultCwd, toWorkspaceRelative } from './paths';
import { writeMeta } from './meta';
import { approveToolCall } from './approval';
import { latestCheckpointFor, restoreCheckpoint, listCheckpoints } from '../checkpoint/store';

export class RestoreFileTool implements Tool {
  readonly name = 'restore_file';
  readonly meta = writeMeta();
  readonly description =
    '把文件恢复到本次会话中【上一次修改之前】的状态（撤销一次写操作）。\n' +
    '适用于你发现 apply_patch / write_file 改错了，想退回原样重来。\n' +
    '只能还原当前会话的修改记录；已经还原过的记录不会重复生效。\n' +
    '⚠️ 还原会覆盖该文件在快照之后的所有改动，如果用户在这期间手动改过，请先确认。';
  readonly parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '要还原的文件路径（必须在工作区内）',
      },
      checkpointId: {
        type: 'string',
        description:
          '可选：指定要还原哪一次操作。不填则自动找该文件最近一次未还原的修改。',
      },
    },
    required: ['path'],
  };

  async execute(args: { path: string; checkpointId?: string }): Promise<ToolResult> {
    const guard = resolveInWorkspace(args.path);
    if (!guard.ok) return { content: guard.error!, isError: true };

    const relPath = toWorkspaceRelative(guard.resolved);
    const abs = guard.resolved;

    // 文件不存在时无法"还原"（那本来就是新建的，本就不该存在）
    if (!fs.existsSync(abs)) {
      const all = listCheckpoints();
      if (all.length === 0) {
        return {
          content: `文件不存在: ${relPath}，且本次会话没有任何修改记录可供还原。`,
          isError: true,
        };
      }
      return {
        content:
          `文件不存在: ${relPath}\n\n` +
          `本次会话共有 ${all.length} 条修改记录，但它不在这些记录里。\n` +
          `如需查看全部记录，请让用户执行 /undo。`,
        isError: true,
      };
    }

    // 找到要还原的 checkpoint
    let cpId = args.checkpointId;
    if (!cpId) {
      const cp = latestCheckpointFor(relPath);
      if (!cp) {
        const all = listCheckpoints();
        const hint =
          all.length === 0
            ? '本次会话还没有任何写操作记录。'
            : `本次会话有 ${all.length} 条修改记录，但都不涉及 ${relPath}。\n` +
              `这些记录涉及：${all.flatMap((c) => c.files.map((f) => f.path)).slice(0, 8).join(', ')}`;
        return {
          content:
            `找不到 ${relPath} 可还原的修改记录。\n\n${hint}\n\n` +
            `[请换一个做法：先用 read_file 看看文件现在的内容，判断是否需要手动改回去。` +
            `如果本次会话确实没有改动记录，说明没有东西需要回滚。]`,
          isError: true,
        };
      }
      cpId = cp.id;
    }

    // ⭐ 权限决策：还原也是写操作（会覆盖/删除文件），
    //   在只读档下必须被拦住 —— 否则 agent 能通过"删了再还原"绕过只读限制。
    const decision = await approveToolCall({
      toolName: this.name,
      meta: this.meta,
      summary: `将还原修改记录 ${cpId}，受影响文件：${relPath}`,
    });
    if (!decision.approved) {
      return {
        content: decision.reason || '用户拒绝了这次还原操作。',
        isError: true,
      };
    }

    const result = restoreCheckpoint(cpId);

    if (!result.ok) {
      return {
        content:
          `还原失败：${result.message}\n\n` +
          `[请换一个做法：可以用 read_file 看看文件现在的内容，判断是否需要手动修改]`,
        isError: true,
      };
    }

    const root = getDefaultCwd();
    const nowExists = fs.existsSync(path.resolve(root, relPath));

    return {
      content:
        `${result.message}\n\n` +
        `还原后的状态：${nowExists ? '文件已恢复' : '文件已被删除（它本来就是新建的）'}。\n` +
        `建议接着用 read_file 确认内容无误，再决定下一步怎么改。`,
    };
  }
}
