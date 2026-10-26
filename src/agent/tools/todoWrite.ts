/**
 * todo_write 工具 —— 维护当前任务的待办清单
 *
 * ─────────────────────────────────────────────────────────────
 * 借鉴 Claude Code 的 TodoWrite（结构化数组 + 三态）
 *
 *   为什么不抄 goose 的极简字符串版：
 *     goose 的 todo.rs 是一个字符串列表，够用但表达力弱。
 *     Claude Code 的结构化版本能表达"正在进行"和"已完成"，
 *     而这两个状态对多步任务非常关键 ——
 *     模型需要知道"我现在正在做哪一件"，而不只是"有一堆待办"。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么它【不】需要审批
 *
 *   meta 用 readOnlyMeta(false)：
 *     · readOnly = true  → 不动用户的文件，不弹审批窗
 *     · concurrentSafe = false → 它改的是全局状态，
 *       两个并发调用会打架，所以必须串行
 *
 *   类比：它在改 agent 自己的记事本，不是在动你的代码。
 *
 * ─────────────────────────────────────────────────────────────
 * 校验规则（为什么要卡"最多一个进行中"）
 *
 *   两个 in_progress 的意思是"模型认为自己同时在做两件事" ——
 *   而它下一轮只能推进一步，那一步推进的是哪一个？
 *   不卡的话，状态会失真，模型就会重复做或漏做。
 */

import { Tool, ToolResult } from './base';
import { readOnlyMeta } from './meta';
import { getTodoStore, Todo, TodoStatus } from '../todo/store';

const VALID_STATUS: TodoStatus[] = ['pending', 'in_progress', 'completed'];

export class TodoWriteTool implements Tool {
  readonly name = 'todo_write';
  readonly meta = readOnlyMeta(false);
  readonly description =
    '维护当前任务的待办清单。\n' +
    '多步任务开始时调用一次（列出全部步骤），之后每完成一步再调用一次更新状态。\n' +
    'status 取值：pending（未开始）/ in_progress（进行中）/ completed（已完成）\n' +
    '同一时刻最多只能有一项是 in_progress。全部完成时传空数组清空清单。';
  readonly parameters = {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: '完整的待办清单（每次调用传全量，不是增量）',
        items: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: '任务描述，祈使句（如"实现 parser"）',
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: '当前状态',
            },
            activeForm: {
              type: 'string',
              description: '进行中的现在分词形式（如"正在实现 parser"），仅 in_progress 时有意义',
            },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  };

  async execute(args: { todos?: Todo[] }): Promise<ToolResult> {
    const todos = args?.todos;

    if (!Array.isArray(todos)) {
      return {
        content: '错误：todos 必须是数组。格式：[{ content: "…", status: "pending" }]',
        isError: true,
      };
    }

    // 校验每一项
    for (let i = 0; i < todos.length; i++) {
      const t = todos[i];
      if (!t || typeof t.content !== 'string' || !t.content.trim()) {
        return { content: `错误：第 ${i + 1} 项缺少 content`, isError: true };
      }
      if (!VALID_STATUS.includes(t.status)) {
        return {
          content:
            `错误：第 ${i + 1} 项的 status 非法（"${t.status}"）。` +
            `只能是 ${VALID_STATUS.join(' / ')}`,
          isError: true,
        };
      }
    }

    // 校验：最多一个 in_progress
    const running = todos.filter((t) => t.status === 'in_progress');
    if (running.length > 1) {
      return {
        content:
          `错误：同时有 ${running.length} 项是 in_progress，只能有 1 项。` +
          `请把正在做的标成 in_progress，其余标成 pending 或 completed。`,
        isError: true,
      };
    }

    getTodoStore().replace(todos);

    const done = todos.filter((t) => t.status === 'completed').length;
    const total = todos.length;
    const current = running[0];

    return {
      content:
        total === 0
          ? '待办清单已清空。'
          : `待办清单已更新：${done}/${total} 已完成` +
            (current ? `，当前进行中：${current.activeForm || current.content}` : '') +
            '。',
    };
  }
}
