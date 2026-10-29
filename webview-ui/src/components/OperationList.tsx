/**
 * 操作列表 —— 这个面板的签名元素
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 为什么工具调用要"折叠成一行"
 *
 *   原版 UI 的工具卡片长这样：
 *     ┌────────────────────────────────┐
 *     │ 📖 read_file                    │
 *     │ 参数                            │
 *     │ {                               │
 *     │   "path": "src/agent/loop.ts",  │  ← 永远展开
 *     │   "offset": 0,                  │
 *     │   "limit": 2000                │
 *     │ }                               │
 *     │ 结果                            │
 *     │ export class AgentLoop {...    │  ← 截断到 800 字符
 *     └────────────────────────────────┘
 *
 *   一个 20 轮的 agent 会调 40~60 次工具。按这个渲染方式，
 *   对话流里 90% 的篇幅是 JSON —— **用户要在一片 JSON 里找那一句人话**。
 *
 *   比喻：原来是把整箱螺丝倒在桌上让你自己找那颗要的。
 *   现在是：桌上只摆一个标签写着「螺丝 M4×20 · 12 个」，
 *   你要细节再拿起来看（点一下展开）。
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 状态节点：为什么每个操作前面有一个小圆点
 *
 *   圆点不是装饰，它是**状态位**：
 *     · 空心   = 已发出，结果还没回来
 *     · 蓝色脉冲 = 正在执行
 *     · 实心绿 = 成功
 *     · 红环   = 失败
 *
 *   一眼扫过去就知道"现在卡在哪一步"。
 *   类比：任务看板上的进度灯。
 * ─────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { IconCheck, IconChevron, IconCross, IconSpinner, ToolIcon } from './icons';

export interface ToolEvent {
  name: string;
  /** 历史会话恢复时不带参数（扩展侧只降维保留 name/result） */
  args?: any;
  result?: string;
  isError?: boolean;
}

type OpState = 'pending' | 'running' | 'done' | 'error';

interface OperationListProps {
  tools: ToolEvent[];
  /** agent 是否正在跑 —— 决定空心点是"待执行"还是"正在执行" */
  streaming?: boolean;
}

/** 参数里最能说明"它在干什么"的键，按优先级排 */
const TARGET_KEYS = [
  'path',
  'file_path',
  'filePath',
  'command',
  'pattern',
  'query',
  'url',
  'target',
  'name',
  'title',
  'description',
  'content',
];

/**
 * 从工具参数里抽出一句"人话"摘要
 *
 * 为什么不直接显示 JSON 的第一行：
 *   `{"path":"src/agent/loop.ts","offset":0}` 的第一行是 `{`，
 *   对用户零信息量。而 `src/agent/loop.ts` 一眼就知道它在读哪个文件。
 */
export function summarizeTarget(tool: ToolEvent): string {
  const args = tool.args;
  if (!args || typeof args !== 'object') return '';

  for (const key of TARGET_KEYS) {
    const v = (args as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }

  // 没有命中已知键 → 退而求其次：第一个字符串值
  for (const v of Object.values(args as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * 中间省略的截断
 *
 * 路径最有价值的两头是「根」和「文件名」，
 * 中间省略比截断尾巴有用得多：
 *   src/agent/operations/toolExecution.ts → src/…/toolExecution.ts
 */
export function truncateMiddle(text: string, max = 46): string {
  if (text.length <= max) return text;
  const keep = Math.floor((max - 1) / 2);
  return `${text.slice(0, keep)}…${text.slice(-keep)}`;
}

export function OperationList({ tools, streaming = false }: OperationListProps) {
  if (!tools || tools.length === 0) return null;
  return (
    <div className="mc-ops">
      {tools.map((tool, i) => (
        <OperationRow key={i} tool={tool} streaming={streaming} />
      ))}
    </div>
  );
}

function OperationRow({ tool, streaming }: { tool: ToolEvent; streaming: boolean }) {
  const [open, setOpen] = useState(false);

  // 结果还没回来 = 还在跑；如果 agent 已经停了还没结果，那是"没等到"
  const state: OpState =
    tool.result !== undefined
      ? tool.isError
        ? 'error'
        : 'done'
      : streaming
        ? 'running'
        : 'pending';

  const target = summarizeTarget(tool);
  const hasDetail = tool.args !== undefined || tool.result !== undefined;

  return (
    <div className={`mc-op mc-op-${state}`}>
      <button
        type="button"
        className="mc-op-row"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!hasDetail}
        title={hasDetail ? (open ? '收起细节' : '展开参数与结果') : '（历史会话未保留细节）'}
      >
        <span className="mc-op-node" aria-hidden="true" />
        <span className="mc-op-icon">
          <ToolIcon name={tool.name} />
        </span>
        <span className="mc-op-name">{tool.name}</span>
        {target && <span className="mc-op-target">{truncateMiddle(target)}</span>}
        <span className="mc-op-state">
          {state === 'running' && <IconSpinner size={13} className="mc-spin" />}
          {state === 'done' && <IconCheck size={13} />}
          {state === 'error' && <IconCross size={13} />}
        </span>
        {hasDetail && (
          <span className={`mc-op-caret${open ? ' open' : ''}`}>
            <IconChevron size={13} />
          </span>
        )}
      </button>

      {open && (
        <div className="mc-op-detail">
          {tool.args !== undefined && (
            <>
              <div className="mc-detail-label">参数</div>
              <pre>{JSON.stringify(tool.args, null, 2)}</pre>
            </>
          )}
          {tool.result !== undefined && (
            <>
              <div className="mc-detail-label">结果</div>
              <pre>
                {tool.result.length > 2000 ? `${tool.result.slice(0, 2000)}\n…（已截断，共 ${tool.result.length} 字符）` : tool.result}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
