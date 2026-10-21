/**
 * record_note 工具 —— 让 agent 自己写错题本
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么必须是 agent 主动写，而不是靠文件监听
 *
 * 文件监听只能知道"src/helper.py 变了"，但错题本的价值在于：
 *   - 为什么这么改？（不看代码是猜不出来的）
 *   - 踩了什么坑？（比如"pytest 在 Windows 下 head 不存在"）
 *   - 测试过没有？结果如何？
 *
 * 这些只有 agent 自己知道 —— 它刚读过失败信息、刚改完、刚验证过。
 * 所以富信息必须由它在任务结束时主动写，监听只做兜底。
 *
 * 另一个理由：让人和 AI 都用同一套记录格式，避免两种风格割裂。
 * ─────────────────────────────────────────────────────────────
 */

import { Tool, ToolResult } from './base';
import { resolveInWorkspace, toWorkspaceRelative, getDefaultCwd } from './paths';
import { readOnlyMeta } from './meta';
import { appendNoteEntry, NoteFileChange } from '../../util/notesStore';

export class RecordNoteTool implements Tool {
  readonly name = 'record_note';
  // 写的是 .notes/ 目录，不碰用户代码，所以按只读对待（自动放行）
  readonly meta = readOnlyMeta();
  readonly description =
    '往今天的错题本（.notes/今天.md）写一条记录。\n\n' +
    '什么时候用：任务完成时，如果你【学到了东西】就记一条 ——\n' +
    '  - 改了不 obvious 的东西（为什么这么改、放弃了什么方案）\n' +
    '  - 踩了坑（某个命令/工具/库在当前环境下不工作）\n' +
    '  - 发现了一个反直觉的事实\n\n' +
    '什么时候不用：纯机械改动（改个常量、加个日志）、没学到新东西时不要记，' +
    '否则错题本会被垃圾淹没。\n\n' +
    'pitfalls 字段最重要 —— 它是错题本区别于"文件修改日志"的关键。';
  readonly parameters = {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: '一句话概括这次改动学到了什么。不超过 40 字。',
      },
      summary: {
        type: 'string',
        description: '详细说明：为什么这么改、尝试过哪些方案、为什么选了这个。',
      },
      files: {
        type: 'array',
        description: '本次改动的文件',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径（相对工作区）' },
            change: { type: 'string', description: '这个文件改了什么，一句话' },
          },
          required: ['path', 'change'],
        },
      },
      pitfalls: {
        type: 'array',
        description:
          '⭐ 踩到的坑 / 反直觉的发现。这一栏是错题本的核心价值，' +
          '例："pytest 在 Windows 下没有 head 命令，截断要在 Node 里做"',
        items: { type: 'string' },
      },
      tests: {
        type: 'string',
        description: '测试情况：跑了什么命令、结果如何。没跑就填"未运行测试"。',
      },
    },
    required: ['title'],
  };

  async execute(args: {
    title: string;
    summary?: string;
    files?: NoteFileChange[];
    pitfalls?: string[];
    tests?: string;
  }): Promise<ToolResult> {
    if (!args.title || typeof args.title !== 'string' || !args.title.trim()) {
      return {
        content: 'record_note 需要 title（一句话概括这次学到了什么）',
        isError: true,
      };
    }

    // 文件路径校验：越界的路径直接拒掉，避免把错题本写坏
    const files: NoteFileChange[] = [];
    for (const f of args.files ?? []) {
      if (!f?.path) continue;
      const guard = resolveInWorkspace(f.path);
      if (!guard.ok) {
        return { content: `files 里的路径越界：${guard.error}`, isError: true };
      }
      files.push({
        path: toWorkspaceRelative(guard.resolved),
        change: (f.change ?? '未说明').slice(0, 200),
      });
    }

    const pitfalls = (args.pitfalls ?? [])
      .filter((p) => typeof p === 'string' && p.trim())
      .map((p) => p.trim().slice(0, 300))
      .slice(0, 10);

    const written = await appendNoteEntry(getDefaultCwd(), {
      kind: 'agent',
      time: new Date().toTimeString().slice(0, 5),
      title: args.title.trim().slice(0, 60),
      summary: args.summary?.trim().slice(0, 1000) || undefined,
      files,
      pitfalls,
      tests: args.tests?.trim().slice(0, 300) || undefined,
    });

    if (!written) {
      return {
        content:
          '错题本写入失败（可能没有打开项目文件夹）。' +
          '这不影响任务本身，继续做你原本要做的事即可。',
        isError: true,
      };
    }

    const bits = [`已记入错题本：${written}`];
    if (files.length) bits.push(`记录了 ${files.length} 个改动文件`);
    if (pitfalls.length) bits.push(`记录了 ${pitfalls.length} 条踩坑`);
    if (args.tests) bits.push('记录了测试结论');

    return {
      content: `📒 ${bits.join('，')}。\n用户可以用 /notes 查看今天的记录。`,
    };
  }
}