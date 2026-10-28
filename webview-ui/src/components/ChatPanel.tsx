/**
 * Webview 聊天面板主组件
 *
 * 跟 Extension 通过 postMessage 通信
 * Extension 发过来的消息：
 * - text: 流式文本片段
 * - tool_call: agent 决定调用工具
 * - tool_result: 工具执行结果
 * - final: agent 完成
 * - error: 错误
 * - toast: 弹窗提示（带可选修复按钮）
 *
 * 发给 Extension 的消息：
 * - ready: Webview 加载完
 * - user_input: 用户发送的任务
 */

import { useState, useEffect, useRef } from 'react';
import { Message, MessageItem } from './Message';
import { TodoList } from './TodoList';

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
  id: number;            // 唯一 ID（用来去重 / 清除）
  level: 'info' | 'warn' | 'error';
  content: string;
  action?: {
    label: string;
    command: string;
  };
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [slashCommands, setSlashCommands] = useState<SlashCmd[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [usage, setUsage] = useState<string>('');
  const [todos, setTodos] = useState<Todo[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const toastIdRef = useRef(0);

  useEffect(() => {
    // 监听 Extension 发来的消息
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        // ⭐ 恢复历史会话：直接把整段历史灌进前端
        //   （之前没有这个 case，导致会话存了盘但用户根本看不到）
        case 'history':
          setMessages(msg.messages || []);
          break;
        // ⭐ 上下文用量：让用户看得见"还剩多少"，也是省钱的心理暗示
        case 'usage':
          setUsage(msg.content || '');
          break;
        // ⭐ 待办清单：agent 更新进度时推过来的
        case 'todo':
          setTodos(msg.todos || []);
          break;
        case 'text':
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                { ...last, content: last.content + msg.content },
              ];
            }
            return [...prev, { role: 'assistant', content: msg.content }];
          });
          break;
        case 'tool_call':
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                {
                  ...last,
                  tools: [...(last.tools || []), { name: msg.name, args: msg.args }],
                },
              ];
            }
            return [
              ...prev,
              { role: 'assistant', content: '', tools: [{ name: msg.name, args: msg.args }] },
            ];
          });
          break;
        case 'tool_result':
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last.tools) {
              const tools = [...last.tools];
              const t = tools[tools.length - 1];
              if (t) t.result = msg.result, (t as any).isError = msg.isError;
              return [...prev.slice(0, -1), { ...last, tools }];
            }
            return prev;
          });
          break;
        case 'final':
          setIsStreaming(false);
          break;
        case 'error':
          setMessages((prev) => [...prev, { role: 'error', content: msg.content }]);
          setIsStreaming(false);
          break;
        case 'toast':
          // 弹个小窗（4 秒后自动消失）
          // 用 id 去重，相同内容不重复弹
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
          if (msg.content === 'ready') {
            // 忽略 initial ready
          }
          break;
        // ⭐ 这个 case 以前不存在，导致 /solve 命令派发给 agent 的任务被静默丢弃：
        //   扩展发 user_input 过来，前端 switch 没匹配上 → 什么都没发生，
        //   但用户已经看到"已派发给 agent"，以为它在跑。
        case 'user_input':
          // 扩展端主动派发的任务（比如 /solve LeetCode），
          // 当成用户输入走一遍发送流程
          setMessages((prev) => [...prev, { role: 'user', content: msg.content }]);
          setIsStreaming(true);
          vscode.postMessage({ type: 'user_input', content: msg.content });
          break;
        case 'clear':
          // 新会话：清空界面消息（扩展端也会清掉它那边的历史）
          setMessages([]);
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
    // 立刻回一次（此时可能只有 probe_alive），再延迟回一次完整的
    flushDiag();
    setTimeout(flushDiag, 2000);
    setTimeout(flushDiag, 5000);

    return () => window.removeEventListener('message', handler);
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text || isStreaming) return;
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setIsStreaming(true);

    if (text.startsWith('/')) {
      vscode.postMessage({ type: 'slash_command', content: text });
    } else {
      vscode.postMessage({ type: 'user_input', content: text });
    }
  }

  // ⭐ 插话：agent 正在干活时补充一句指令
  //
  //   和"停止"的区别：
  //     停止 → 中断整个任务，已完成的部分保留，但要重新说下一步
  //     插话 → 不打断，消息排队，等当前这批工具跑完注入下一轮
  //
  //   比喻：秘书正在写稿，老板说"这句改一下"——
  //   秘书不推倒重写，而是记下来在下一个停顿处改。
  function handleSteer() {
    const text = input.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
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
    setMessages([]);
    setIsStreaming(false);
    setInput('');
  }

  // 点 toast 上的"修复按钮"
  function handleToastAction(action: { label: string; command: string }) {
    vscode.postMessage({ type: 'run_command', command: action.command });
    setToast(null); // 点了就关掉
  }

  return (
    <div className="chat-panel">
      {/* Toast 小弹窗（右上角浮着） */}
      {toast && (
        <div className={`toast toast-${toast.level}`}>
          <div className="toast-content">{toast.content}</div>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => handleToastAction(toast.action!)}
            >
              {toast.action.label}
            </button>
          )}
          <button className="toast-close" onClick={() => setToast(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="messages">
        {/* ⭐ 待办清单：固定在对话上方，实时显示多步任务进度 */}
        <TodoList todos={todos} />
        {messages.length === 0 && (
          <div className="empty">
            <h3>👋 你好，我是 Mini-Coder</h3>
            <p>用自然语言告诉我任务，或用 slash command 触发 workflow：</p>
            <ul>
              <li>"把 main.py 改成 async"</li>
              <li>"给 add 函数加单元测试"</li>
              <li>"重构 utils.py 里的重复代码"</li>
            </ul>
            {slashCommands.length > 0 && (
              <>
                <h4>⚡ 快捷命令（slash commands）</h4>
                <ul>
                  {slashCommands.map((c) => (
                    <li key={c.name}>
                      <code>/{c.name}{c.argsHint ? ` ${c.argsHint}` : ''}</code> — {c.description}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p style={{ marginTop: 16, fontSize: 12, opacity: 0.7 }}>
              💡 出问题时输入 <code>/doctor</code> 自检，或 <code>/logs</code> 复制日志给开发者
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageItem key={i} message={m} />
        ))}
        {isStreaming && <div className="typing">🤔 Mini-Coder 正在思考...</div>}
        <div ref={messagesEndRef} />
      </div>
      <div className="input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey) return;
            // ⭐ 正在跑的时候 Enter 是【插话】，不是【发送】
            //   —— 发新任务会打断当前任务，而插话是排队生效。
            if (isStreaming) handleSteer();
            else handleSend();
          }}
          placeholder={
            isStreaming
              ? '补充一句指令（排队生效，不打断当前任务）…'
              : '输入任务（如：把 main.py 改成 async），或 /test /commit /undo /notes /doctor'
          }
        />
        {isStreaming ? (
          // ⭐ 停止按钮：Agent 跑飞时用户唯一的自救手段
          <>
            <button className="stop-btn" onClick={handleStop} title="中断当前任务">
              ⏹ 停止
            </button>
            {/* ⭐ 插话按钮：不停手，只是补一句 */}
            <button
              className="steer-btn"
              onClick={handleSteer}
              disabled={!input.trim()}
              title="补充一句指令，排队到下一轮生效（不打断当前任务）"
            >
              💬 插话
            </button>
          </>
        ) : (
          <button onClick={handleSend} disabled={!input.trim()}>
            发送
          </button>
        )}
      </div>
      <div className="input-footer">
        <button
          className="link-btn"
          onClick={handleNewSession}
          disabled={messages.length === 0 && !isStreaming}
          title="清空对话历史，重新开始"
        >
          🗑 新会话
        </button>
        <button
          className="link-btn"
          onClick={() => vscode.postMessage({ type: 'run_command', command: 'mini-coder.restoreSession' })}
          title="恢复之前的历史会话"
        >
          📂 历史会话
        </button>
        {/* ⭐ 上下文用量：让用户看得见"还剩多少额度"，也是省钱的心理暗示 */}
        {usage && <span className="usage" title="本轮对话已占用的上下文 / 模型上限">{usage}</span>}
        <span className="hint">Enter 发送 · / 开头的走快捷命令 · /undo 撤销改动</span>
      </div>
    </div>
  );
}