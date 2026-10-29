/**
 * 顶部状态条
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 为什么把"状态"集中到一条，而不是散在面板各处
 *
 *   原来：待办清单在对话上方（一个卡片），上下文用量在底部（一个文字），
 *         运行状态靠底部一句"正在思考"。
 *   结果：用户要三个地方才能知道"现在什么情况"。
 *
 *   现在：**所有状态收进这一条**——
 *     身份（左）· 运行状态（中）· 任务进度（中）· 上下文用量（右）
 *   眼睛横着扫一遍，整个面板的现状就清楚了。
 *   类比：仪表盘。指针都在一个地方，不用到处找。
 *
 * ─────────────────────────────────────────────────────────────
 */

import { IconMark, IconList } from './icons';

export interface StatusStripProps {
  /** 是否正在执行 */
  streaming: boolean;
  /** 待办总数与已完成数 */
  todoDone: number;
  todoTotal: number;
  /** 上下文用量文本（扩展侧已经格式化好，这里只负责排版） */
  usage: string;
}

export function StatusStrip({ streaming, todoDone, todoTotal, usage }: StatusStripProps) {
  const hasTodos = todoTotal > 0;
  const stateLabel = streaming ? '执行中' : todoTotal > 0 && todoDone >= todoTotal ? '已完成' : '待命';

  return (
    <header className="mc-header">
      <div className="mc-brand">
        <IconMark size={17} className="mc-brand-mark" />
        <span className="mc-brand-name">Mini-Coder</span>
      </div>

      <span className={`mc-state${streaming ? ' running' : ''}`}>
        <i className="mc-state-dot" aria-hidden="true" />
        {stateLabel}
      </span>

      {hasTodos && (
        <span className="mc-todo-mini" title={`任务进度 ${todoDone}/${todoTotal}`}>
          <IconList size={12} />
          <span className="mc-seg" aria-hidden="true">
            {Array.from({ length: todoTotal }).map((_, i) => (
              <i key={i} className={i < todoDone ? 'done' : i === todoDone ? 'cur' : ''} />
            ))}
          </span>
          <span className="mc-todo-mini-count">
            {todoDone}/{todoTotal}
          </span>
        </span>
      )}

      {usage && (
        <span className="mc-usage" title="本轮对话已占用的上下文 / 模型上限">
          {usage}
        </span>
      )}
    </header>
  );
}
