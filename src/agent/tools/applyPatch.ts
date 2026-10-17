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

      const filePath = path.resolve(edit.path);
      // 用 stat 判断"存在且是文件"（不能只看 access —— 后面 readFile 会 EISDIR 崩溃）
      const stat = await fs.stat(filePath).catch(() => null);
      const exists = stat?.isFile() ?? false;
      const original = exists ? await fs.readFile(filePath, 'utf-8') : '';
      backups.set(filePath, exists ? original : null);

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

        const newContent = original.replace(edit.old_text, edit.new_text);
        writes.set(filePath, newContent.endsWith('\n') ? newContent : newContent + '\n');
        summaries.push(`~ ${edit.path}`);
      }
    }

    if (args.dry_run) {
      return { content: `Dry-run OK:\n${summaries.join('\n')}` };
    }

    // 真写盘 + 失败回滚
    try {
      for (const [filePath, content] of writes) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
      }
      return { content: `已应用 ${summaries.length} 个 edit:\n${summaries.join('\n')}` };
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