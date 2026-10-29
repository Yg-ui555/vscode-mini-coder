/**
 * Webview 聊天面板主组件
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐⭐ 本次重写的两个核心决策
 *
 * ① 【事件时间线】而不是【合并消息】
 *
 *   旧模型：messages[] 里一条 assistant 消息同时装"正文"和"工具列表"。
 *   问题一：多轮的工具和正文会**全挤进同一条消息**，
 *           渲染时无法还原真实先后顺序。
 *   问题二（真 bug）：工具结果一律挂到 `tools[tools.length - 1]`，
 *           而扩展侧对并行工具是"先发 N 个调用、再按序发 N 个结果"，
 *           于是**前 N-1 个工具永远拿不到结果**，最后一个被覆盖 N 次。
 *
 *   新模型：维护一条**扁平事件时间线**，事件按到达顺序入列。
 *     · text       → 追加/新建一段正文
 *     · tool_call  → 入列一个操作节点
 *     · tool_result→ 按【同名 FIFO】回填到最早那个还没结果的节点
 *
 *   好处：
 *     · 顺序天然正确，不需要任何"推断轮次"的启发式规则
 *     · 并行工具的结果各归各位（bug 顺手修掉）
 *     · 渲染层只需按顺序画，不用理解协议细节
 *
 *   比喻：旧版是把一天发生的事按"说的话/做的事"分两栏记账，
 *   结果账目乱了；新版是一本流水账，一行一件，顺序天然对。
 *
 * ② 【操作时间线】而不是【聊天气泡】
 *
 *   见 OperationList.tsx 的说明：工具调用折叠成一行，
 *   挂在一条贯穿的竖线上，节点颜色表示状态。
 *
 * ─────────────────────────────────────────────────────────────
 * 与扩展的 postMessage 协议（**保持不变**，本次只改渲染）
 *   Extension → Webview:
 *     history / usage / todo / text / tool_call / tool_result /
 *     final / error / toast / slash_commands / status / user_input / clear
 *   Webview → Extension:
 *     ready / user_input / slash_command / steer / stop / new_session / run_command
 * ─────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageItem, ToolEvent } from './Message';
import { OperationList } from './OperationList';
import { TodoList } from './TodoList';
import { StatusStrip } from './StatusStrip';
import { EmptyState } from './EmptyState';
import { IconAlert, IconChat, IconHistory, IconPlus, IconSend, IconStop } from './icons';

// VS Code exposes its Webview API through acquireVsCodeApi(), not a `vscode` global.
declare function acquireVsCodeApi(): {
  postMessage: (msg: any) => void;
};

const vscode = acquireVsCodeApi();

interface SlashCmd {
  name: string;
  description: string;
  argsHint?: string;
}

interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

interface Toast {
  id: number;
  level: 'info' | 'warn' | 'error';
  content: string;
  action?: { label: string; command: string };
}

/**
 * 时间线上的一条事件
 *
 * kind=user   → 用户下的指令
 * kind=text   → agent 的一段正文
 * kind=tool   → 一次工具调用
 * kind=error  → 出错了
 */
interface Item {
  id: number;
  kind: 'user' | 'text' | 'tool' | 'error';
  text?: string;
  tool?: ToolEvent;
  compacted?: boolean;
}

export function ChatPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [slashCommands, setSlashCommands] = useState<SlashCmd[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [usage, setUsage] = useState('');
  const [todos, setTodos] = useState<Todo[]>([]);

  const nextId = useRef(1);
  const toastIdRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    // 监听 Extension 发来的消息
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        // ⭐ 恢复历史会话：历史是"合并消息"形态，转成时间线
        case 'history': {
          const restored: Item[] = [];
          for (const m of msg.messages || []) {
            if (m.role === 'user') {
              restored.push({ id: nextId.current++, kind: 'user', text: m.content, compacted: m.compacted });
            } else if (m.role === 'error') {
              restored.push({ id: nextId.current++, kind: 'error', text: m.content });
            } else {
              // 历史里的 tools 只有 name/result，没有 args（扩展侧降维过）
              //
              // ⭐ 顺序：先正文、后工具 —— 和【实时流】的顺序保持一致。
              //   实时流里一轮的顺序是「LLM 先吐字、再发工具调用」，
              //   所以历史还原也必须先字后工具，否则刷新一次版式就变了。
              if (m.content) {
                restored.push({ id: nextId.current++, kind: 'text', text: m.content, compacted: m.compacted });
              }
              for (const t of m.tools || []) {
                restored.push({
                  id: nextId.current++,
                  kind: 'tool',
                  tool: { name: t.name, result: t.result, isError: t.isError },
                });
              }
            }
          }
          setItems(restored);
          break;
        }

        // ⭐ 上下文用量：让用户看得见"还剩多少"，也是省钱的心理暗示
        case 'usage':
          setUsage(msg.content || '');
          break;

        // ⭐ 待办清单：agent 更新进度时推过来的
        case 'todo':
          setTodos(msg.todos || []);
          break;

        // 正文片段：连续的片段合并成一段，段与段之间自然分段
        case 'text':
          setItems((prev) => {
            const chunk = msg.content || '';
            const last = prev[prev.length - 1];
            if (last && last.kind === 'text') {
              return [...prev.slice(0, -1), { ...last, text: (last.text || '') + chunk }];
            }
            return [...prev, { id: nextId.current++, kind: 'text', text: chunk }];
          });
          break;

        // 工具调用：入列一个操作节点
        case 'tool_call':
          setItems((prev) => [
            ...prev,
            {
              id: nextId.current++,
              kind: 'tool',
              tool: { name: msg.name, args: msg.args },
            },
          ]);
          break;

        // ⭐ 工具结果：按【同名 FIFO】回填
        //
        //   为什么不能像旧版那样挂到最后一个：
        //   扩展侧对并行工具是"先发 N 个 tool_call，再按序发 N 个 tool_result"
        //   （见 src/agent/operations/toolExecution.ts:178-186 与 :217-238）。
        //   挂到最后一个 → 前 N-1 个永远没有结果，最后一个被覆盖 N 次。
        //
        //   同名 FIFO：找出最早那个"同名的、还没有结果的"节点填上。
        //   一次调用一次结果，顺序严格对应。
        case 'tool_result':
          setItems((prev) => {
            const idx = prev.findIndex(
              (it) => it.kind === 'tool' && it.tool?.name === msg.name && it.tool?.result === undefined,
            );
            if (idx < 0) return prev;
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              tool: { ...next[idx].tool!, result: msg.result, isError: !!msg.isError },
            };
            return next;
          });
          break;

        case 'final':
          setIsStreaming(false);
          break;

        case 'error':
          setItems((prev) => [
            ...prev,
            { id: nextId.current++, kind: 'error', text: msg.content },
          ]);
          setIsStreaming(false);
          break;

        case 'toast':
          toastIdRef.current += 1;
          const newToast: Toast = {
            id: toastIdRef.current,
            level: msg.level || 'info',
            content: msg.content,
            action: msg.action,
          };
          setToast(newToast);
          setTimeout(() => {
            setToast((cur) => (cur?.id === newToast.id ? null : cur));
          }, 5000);
          break;

        case 'slash_commands':
          setSlashCommands(msg.commands || []);
          break;

        case 'status':
          break;

        // ⭐ 扩展端主动派发的任务（比如 /solve LeetCode），
        //   当成用户输入走一遍发送流程。
        //   （以前这个 case 不存在，任务被静默丢弃 —— 用户以为它在跑。）
        case 'user_input':
          setItems((prev) => [
            ...prev,
            { id: nextId.current++, kind: 'user', text: msg.content },
          ]);
          setIsStreaming(true);
          vscode.postMessage({ type: 'user_input', content: msg.content });
          break;

        case 'clear':
          setItems([]);
          setIsStreaming(false);
          setTodos([]);
          break;
      }
    };

    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });

    // ⭐ 把 webview 内部的自诊断证据回传给扩展
    //   探针（扩展注入的脚本）只负责采集，采集结果存在 window.__miniCoderDiag。
    //   这里负责回传 —— 因为 acquireVsCodeApi 一个 webview 只能调一次，
    //   探针抢调会把前端自己搞崩。
    const diag = (window as any).__miniCoderDiag;
    const flushDiag = () => {
      const events = diag?.events || [];
      if (!events.length) return;
      vscode.postMessage({ type: 'diag_report', payload: { events } });
    };
    flushDiag();
    setTimeout(flushDiag, 2000);
    setTimeout(flushDiag, 5000);

    return () => window.removeEventListener('message', handler);
  }, []);

  // ── 自动滚动：只在用户本来就贴着底部时才跟着滚 ──
  //
  //   为什么不是"每次都 scrollIntoView"：
  //   流式输出时每个字符片段都会触发一次平滑滚动，
  //   页面会一直在抖，而且用户往上翻历史时会被强行拽回底部。
  //   常见做法是判断"离底部 < 80px 才自动跟"。
  const onScroll = () => {
    const el = document.querySelector('.mc-body') as HTMLElement | null;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (!stickRef.current) return;
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [items]);

  // 输入框随内容自动变高（1~6 行），别让长任务挤成一条缝
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  function handleSend() {
    const text = input.trim();
    if (!text || isStreaming) return;
    setItems((prev) => [...prev, { id: nextId.current++, kind: 'user', text }]);
    setInput('');
    setIsStreaming(true);
    stickRef.current = true;

    if (text.startsWith('/')) {
      vscode.postMessage({ type: 'slash_command', content: text });
    } else {
      vscode.postMessage({ type: 'user_input', content: text });
    }
  }

  // ⭐ 插话：agent 正在干活时补充一句指令
  //   和"停止"的区别：
  //     停止 → 中断整个任务，已完成的部分保留，但要重新说下一步
  //     插话 → 不打断，消息排队，等当前这批工具跑完注入下一轮
  //   比喻：秘书正在写稿，老板说"这句改一下"——
  //   秘书不推倒重写，而是记下来在下一个停顿处改。
  function handleSteer() {
    const text = input.trim();
    if (!text) return;
    setItems((prev) => [...prev, { id: nextId.current++, kind: 'user', text }]);
    setInput('');
    vscode.postMessage({ type: 'steer', content: text });
  }

  // ⭐ 停止：以前 Agent 一旦跑飞，用户只能关掉整个 VS Code
  function handleStop() {
    vscode.postMessage({ type: 'stop' });
    setIsStreaming(false);
  }

  // 新会话：清空对话历史，重新加载 system prompt
  function handleNewSession() {
    vscode.postMessage({ type: 'new_session' });
    setItems([]);
    setIsStreaming(false);
    setInput('');
  }

  // 点 toast 上的"修复按钮"
  function handleToastAction(action: { label: string; command: string }) {
    vscode.postMessage({ type: 'run_command', command: action.command });
    setToast(null);
  }

  // 空状态里点示例 → 填进输入框（不直接发送，让用户先改一眼）
  function handlePickExample(text: string) {
    setInput(text);
    textareaRef.current?.focus();
  }

  const todoDone = todos.filter((t) => t.status === 'completed').length;
  const hasContent = items.length > 0;

  return (
    <div className="mc-shell">
      {/* ── 顶部状态条：身份 · 状态 · 进度 · 用量 ── */}
      <StatusStrip
        streaming={isStreaming}
        todoDone={todoDone}
        todoTotal={todos.length}
        usage={usage}
      />

      {/* ── 主体 ── */}
      <div className="mc-body" onScroll={onScroll}>
        <div className="mc-body-inner">
          {todos.length > 0 && <TodoList todos={todos} />}

          {!hasContent ? (
            <EmptyState slashCommands={slashCommands} onPick={handlePickExample} />
          ) : (
            <div className="mc-timeline">
              {items.map((it) => {
                if (it.kind === 'tool') {
                  return (
                    <div className="mc-tl-tool" key={it.id}>
                      <OperationList tools={[it.tool!]} streaming={isStreaming} />
                    </div>
                  );
                }
                if (it.kind === 'error') {
                  return (
                    <div className="mc-tl-error" key={it.id}>
                      <div className="mc-error">
                        <span className="mc-error-icon">
                          <IconAlert size={14} />
                        </span>
                        <div className="mc-error-body">{it.text}</div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="mc-tl-msg" key={it.id}>
                    <MessageItem
                      message={{
                        role: it.kind === 'user' ? 'user' : 'assistant',
                        content: it.text || '',
                        compacted: it.compacted,
                      }}
                    />
                  </div>
                );
              })}

              {isStreaming && (
                <div className="mc-thinking">
                  <span className="mc-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  正在执行
                </div>
              )}
            </div>
          )}

          <div ref={endRef} />
        </div>
      </div>

      {/* ── 输入区 ── */}
      <div className="mc-composer">
        <div className="mc-input-wrap">
          <textarea
            ref={textareaRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
              e.preventDefault();
              // ⭐ 正在跑的时候 Enter 是【插话】，不是【发送】
              //   —— 发新任务会打断当前任务，而插话是排队生效。
              if (isStreaming) handleSteer();
              else handleSend();
            }}
            placeholder={
              isStreaming
                ? '补充一句指令（排队生效）…'
                : '描述任务，或输入 / 打开快捷命令'
            }
          />
          {isStreaming ? (
            <>
              <button
                type="button"
                className="mc-btn mc-btn-danger"
                onClick={handleStop}
                title="中断当前任务"
              >
                <IconStop size={13} />
                停止
              </button>
              <button
                type="button"
                className="mc-btn mc-btn-ghost"
                onClick={handleSteer}
                disabled={!input.trim()}
                title="补充一句指令，排队到下一轮生效（不打断当前任务）"
              >
                <IconChat size={13} />
                插话
              </button>
            </>
          ) : (
            <button
              type="button"
              className="mc-btn mc-btn-primary"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              <IconSend size={13} />
              发送
            </button>
          )}
        </div>

        <div className="mc-footer">
          <button
            type="button"
            className="mc-link"
            onClick={handleNewSession}
            disabled={!hasContent && !isStreaming}
            title="清空对话历史，重新开始"
          >
            <IconPlus size={12} />
            新会话
          </button>
          <button
            type="button"
            className="mc-link"
            onClick={() => vscode.postMessage({ type: 'run_command', command: 'mini-coder.restoreSession' })}
            title="恢复之前的历史会话"
          >
            <IconHistory size={12} />
            历史
          </button>
          <span className="mc-footer-hint">Enter 发送 · Shift+Enter 换行</span>
        </div>
      </div>

      {/* ── Toast 小弹窗（右上角浮着） ── */}
      {toast && (
        <div className={`mc-toast mc-toast-${toast.level}`} role="status">
          <div className="mc-toast-content">{toast.content}</div>
          {toast.action && (
            <button
              type="button"
              className="mc-toast-action"
              onClick={() => handleToastAction(toast.action!)}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="mc-toast-close" onClick={() => setToast(null)} aria-label="关闭">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
