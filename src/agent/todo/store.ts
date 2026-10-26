/**
 * 待办清单（Todo）—— 状态管理 + 渲染
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 这套机制解决什么
 *
 *   agent 做多步任务时，怎么知道自己走到第几步了？
 *
 *   没有待办清单的时候，它只能靠翻聊天记录推断 ——
 *   而聊天记录会被上下文压缩掉。一旦被压掉，
 *   它就"忘了"自己已经做完哪些、还剩哪些，于是：
 *     · 重复做已经做完的事
 *     · 或者干脆从头再来
 *
 *   比喻：待办清单就像【航班号】。
 *   写在黑板上（内存里）—— 飞机降落后黑板擦了，
 *   旅客就不知道自己该转哪个航站楼。
 *   必须写在【系统里】（会话文件），关掉 VS Code 再打开还在。
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐⭐ 最关键的一条：每轮请求前【重建】注入，不是追加
 *
 *   不能只在对话里留一条 tool 消息（"我更新了待办清单"）——
 *   因为上下文压缩会把那条消息压掉，模型就不知道自己走到第几步了。
 *
 *   所以做法是：每轮请求前，把【当前】的待办状态重新渲染成一条
 *   system 消息，替换掉上一轮的那条。
 *
 *   ⚠️ 必须是【替换】不是【追加】：
 *   追加的话，上下文里会堆 N 条历史快照，越滚越大 ——
 *   而 ReAct 循环每一步都要重发全部上下文，堆起来就是纯烧钱。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么状态独立于消息历史
 *
 *   借鉴 goose 的 session/extension_data.rs —— 状态存 session，
 *   不存在消息流里。消息流会被压缩，状态不会。
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface Todo {
  /** 任务描述（祈使句，如"实现 parser"） */
  content: string;
  status: TodoStatus;
  /** 进行中的现在分词形式（如"正在实现 parser"） */
  activeForm?: string;
}

/** 待办清单的存储上限 —— 防止模型写出一万条待办撑爆上下文 */
const MAX_TODOS = 30;

/**
 * 待办状态容器（模块级单例）
 *
 * 为什么用单例而不是实例：
 *   它跟 repeatGuard（重复调用检测）、hook manager 是同一类东西 ——
 *   全局唯一的"agent 运行时状态"，谁都能读，但只有工具能写。
 *   保持一致的风格，review 时不用重新理解一套。
 */
class TodoStore {
  private todos: Todo[] = [];

  /** 当前待办（返回副本，防止外部偷偷改） */
  get(): Todo[] {
    return this.todos.map((t) => ({ ...t }));
  }

  /**
   * 整体替换
   *
   * 为什么是"整体替换"而不是"增量"：
   *   模型每次调用 todo_write 都应该传【完整的】清单。
   *   增量更新（只传变化项）需要模型自己做差集，容易出错，
   *   而且出错之后状态就没法自愈了。
   */
  replace(todos: Todo[]): void {
    this.todos = todos.slice(0, MAX_TODOS).map((t) => ({ ...t }));
  }

  clear(): void {
    this.todos = [];
  }

  /** 有没有待办 */
  get isEmpty(): boolean {
    return this.todos.length === 0;
  }

  /** 已完成的比例（0~1），给 UI 画进度条用 */
  get progress(): number {
    if (this.todos.length === 0) return 0;
    const done = this.todos.filter((t) => t.status === 'completed').length;
    return done / this.todos.length;
  }

  /**
   * 渲染成给模型看的文本块
   *
   * ⚠️ 格式的讲究：
   *   · 用 ☐ / ▶ / ☑ 三种符号，模型对这两个字符的区分度很高
   *   · 正在进行的那条用 activeForm（"正在实现 parser"）而不是 content
   *     —— 因为"正在做 X"比"做 X"更能让模型保持在场
   *   · 最后一行给出计数，让模型知道自己还剩多少
   */
  render(): string {
    if (this.todos.length === 0) return '';

    const lines = this.todos.map((t) => {
      const mark = t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '▶' : '☐';
      const text = t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content;
      return `${mark} ${text}`;
    });

    const done = this.todos.filter((t) => t.status === 'completed').length;
    const total = this.todos.length;

    return [
      '# 当前任务清单',
      '',
      ...lines,
      '',
      `进度：${done}/${total} 已完成。`,
      '',
      '说明：',
      '- 这份清单是任务的进度真相。每完成一步，立刻用 todo_write 更新状态。',
      '- 同一时刻最多只能有一项是「进行中」。',
      '- 全部完成后，把清单清空（传空数组）并向用户汇报。',
    ].join('\n');
  }
}

/** 全局单例 */
const store = new TodoStore();

export function getTodoStore(): TodoStore {
  return store;
}

/** 便捷函数：渲染（空清单返回空串） */
export function renderTodoBlock(): string {
  return store.render();
}
