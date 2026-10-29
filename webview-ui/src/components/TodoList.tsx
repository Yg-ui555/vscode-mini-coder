/**
 * 待办清单
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么进度条在顶栏，这里只留清单
 *
 *   顶栏那条分段进度条回答的是"**比例**"（干了多少）——
 *   一眼扫过就够了，不需要再在这里画第二根。
 *   这里回答的是"**内容**"（具体在干哪几步）。
 *
 *   同一个信息只画一次，这是"简洁"的底层原则。
 *
 *   比喻：仪表盘上有转速表，屏幕上就不该再挂一个同款转速表。
 * ─────────────────────────────────────────────────────────────
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

  return (
    <section className="mc-todo" aria-label="任务清单">
      {/*
        这里【不画计数】—— 顶栏已经有一处了（分段进度条 + n/m）。
        同一个信息画两次，其中一处必然会被当成噪声。
        顶栏那处常驻可见、滚动时也在，所以它才是该保留的那一个。
      */}
      <div className="mc-todo-head">
        <span className="mc-todo-title">任务</span>
      </div>
      <ul className="mc-todo-items">
        {todos.map((t, i) => {
          const label = t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content;
          return (
            <li key={i} className={`mc-todo-item mc-todo-${t.status}`}>
              <span className="mc-todo-mark" aria-hidden="true" />
              <span className="mc-todo-text">{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
