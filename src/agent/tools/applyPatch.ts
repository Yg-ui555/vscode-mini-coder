/**
 * apply_patch 工具 - 杀手特性
 *
 * 为什么不用 write_file 整文件覆盖：
 * - 全量覆盖浪费（LLM 要重新输出整个文件）
 * - 全量覆盖不安全（LLM 可能漏掉一行就写入）
 *
 * 为什么不用 sed：
 * - sed 转义规则复杂（LLM 不会写 \\ \\\\）
 * - 多文件多 patch 难表达
 * - 结构化 edit 列表 LLM 看得更清楚
 *
 * 协议：
 * - 每个 edit = {path, action: "replace"|"add", old_text, new_text}
 * - replace 要求 old_text 唯一匹配（防歧义）
 * - add 追加到末尾
 * - dry_run=true 只校验不写盘
 * - 失败自动 rollback
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Tool, ToolResult } from './base';
import { resolveInWorkspace, toWorkspaceRelative } from './paths';
import { requireWriteApproval } from './approval';

interface Edit {
  path?: string;
  action?: 'replace' | 'add';
  old_text?: string;
  new_text?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class ApplyPatchTool implements Tool {
  readonly name = 'apply_patch';
  readonly description =
    '结构化文件编辑。支持多文件批量修改，每个 edit 指定 path + action + old_text + new_text。' +
    'action=replace 要求 old_text 唯一匹配（防歧义）。action=add 追加到末尾。' +
    '改之前设 dry_run=true 可以只校验不写盘。失败自动 rollback。';
  readonly parameters = {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        description: 'edit 列表',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            action: { type: 'string', enum: ['replace', 'add'] },
            old_text: { type: 'string' },
            new_text: { type: 'string' },
          },
          required: ['path', 'action'],
        },
      },
      dry_run: { type: 'boolean', default: false, description: '只校验不写盘' },
    },
    required: ['edits'],
  };

  async execute(args: { edits: Edit[]; dry_run?: boolean }): Promise<ToolResult> {
    const writes = new Map<string, string>();
    const backups = new Map<string, string | null>();
    const summaries: string[] = [];

    for (const edit of args.edits) {
      if (!edit.path || !edit.action) {
        return { content: '每个 edit 必须包含 path 和 action', isError: true };
      }

      // 路径必须落在工作区内（防 LLM 写到工作区外面去）
      const guard = resolveInWorkspace(edit.path);
      if (!guard.ok) {
        return { content: guard.error!, isError: true };
      }
      const filePath = guard.resolved;

      // ⭐ 关键修复：同一文件多个 edit 时，必须基于"前一个 edit 改完的结果"继续改。
      //    否则每个 edit 都从磁盘原文算起，writes.set 互相覆盖，
      //    最终只有最后一个 edit 生效，但 summaries 会报告"全部成功"——静默丢改动。
      //    （已实测复现：3 个 edit 全部指向同一文件，只有第 3 个真正写入）
      const pending = writes.get(filePath);
      const stat = await fs.stat(filePath).catch(() => null);
      const exists = stat?.isFile() ?? false;
      const original = pending !== undefined
        ? pending
        : (exists ? await fs.readFile(filePath, 'utf-8') : '');

      // backup 只记第一次（磁盘真实原内容），保证回滚能还原到最初状态
      if (!backups.has(filePath)) {
        backups.set(filePath, exists ? original : null);
      }

      if (edit.action === 'add') {
        if (!edit.new_text) {
          return { content: `add 操作必须提供 new_text: ${edit.path}`, isError: true };
        }
        const sep = original && !original.endsWith('\n') ? '\n' : '';
        writes.set(filePath, original + sep + edit.new_text + '\n');
        summaries.push(`+ ${edit.path}`);
      } else if (edit.action === 'replace') {
        if (!edit.old_text || edit.new_text === undefined) {
          return {
            content: `replace 操作必须提供 old_text 和 new_text: ${edit.path}`,
            isError: true,
          };
        }

        // 唯一匹配校验（防歧义）
        const occurrences = (original.match(new RegExp(escapeRegex(edit.old_text), 'g')) || [])
          .length;

        if (occurrences === 0) {
          return { content: `old_text 未在 ${edit.path} 中找到`, isError: true };
        }
        if (occurrences > 1) {
          return {
            content: `old_text 在 ${edit.path} 中出现 ${occurrences} 次，必须唯一匹配`,
            isError: true,
          };
        }

        // 用函数形式替换：避免 new_text 里的 $& / $1 / $` 被当成正则替换符
        // （直接 replace(str, str) 时 $ 有特殊含义，会静默篡改用户代码）
        const newContent = original.replace(edit.old_text, () => edit.new_text!);
        writes.set(filePath, newContent.endsWith('\n') ? newContent : newContent + '\n');
        summaries.push(`~ ${edit.path}`);
      }
    }

    if (args.dry_run) {
      return { content: `Dry-run OK:\n${summaries.join('\n')}` };
    }

    // ⭐ 写操作确认：让用户知道 AI 要改他的文件（dry_run 不打扰）
    const approved = await requireWriteApproval(
      this.name,
      `将修改 ${writes.size} 个文件：\n${[...writes.keys()]
        .map((p) => `• ${toWorkspaceRelative(p)}`)
        .join('\n')}`,
    );
    if (!approved) {
      return {
        content: '用户拒绝了这次修改请求。不要重复请求同一个改动，先向用户确认需求。',
        isError: true,
      };
    }

    // 真写盘 + 失败回滚
    try {
      for (const [filePath, content] of writes) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
      }
      return {
        content:
          `已应用 ${summaries.length} 个 edit（涉及 ${writes.size} 个文件）:\n` +
          `${summaries.join('\n')}\n\n` +
          `⚠ 后续若要再改这些文件，请用 read_file 重新读取最新内容——` +
          `old_text 必须匹配文件里的真实文本。`,
      };
    } catch (e: any) {
      // 回滚
      for (const [filePath, original] of backups) {
        try {
          if (original === null) {
            await fs.unlink(filePath);
          } else {
            await fs.writeFile(filePath, original, 'utf-8');
          }
        } catch {
          // rollback 失败不致命
        }
      }
      return { content: `应用失败，已回滚: ${e.message}`, isError: true };
    }
  }
}