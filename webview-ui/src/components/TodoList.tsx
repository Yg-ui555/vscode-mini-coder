/**
 * 待办清单组件
 *
 * 显示 agent 当前的多步任务进度。
 *
 * ⭐ 为什么前端要单独渲染一份，而不是从消息流里推导
 *
 *   消息流会被上下文压缩掉，而待办状态存在 session 里 ——
 *   两者的生命周期不同。UI 订阅的是"状态"，不是"历史"。
 *
 *   类比：黑板（消息流）会被擦，任务看板（待办）不会。
 */

interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

interface TodoListProps {
  todos: Todo[];
}

export function TodoList({ todos }: TodoListProps) {
  if (!todos || todos.length === 0) return null;

  const done = todos.filter((t) => t.status === 'completed').length;
  const percent = Math.round((done / todos.length) * 100);
  const current = todos.find((t) => t.status === 'in_progress');

  return (
    <div className="todo-list">
      <div className="todo-header">
        <span className="todo-title">📋 任务清单</span>
        <span className="todo-count">
          {done}/{todos.length}
        </span>
      </div>

      {/* 进度条 —— 让用户一眼看出"它干了多少" */}
      <div className="todo-progress">
        <div className="todo-progress-fill" style={{ width: `${percent}%` }} />
      </div>

      <ul className="todo-items">
        {todos.map((t, i) => (
          <li key={i} className={`todo-item todo-${t.status}`}>
            <span className="todo-mark">
              {t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '▶' : '☐'}
            </span>
            <span className="todo-text">
              {/* 进行中的显示 activeForm（"正在实现 parser"）而不是 content */}
              {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
            </span>
          </li>
        ))}
      </ul>

      {current && (
        <div className="todo-current">
          正在进行：{current.activeForm || current.content}
        </div>
      )}
    </div>
  );
}
