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
 *
 * 发给 Extension 的消息：
 * - ready: Webview 加载完
 * - user_input: 用户发送的任务
 */

import { useState, useEffect, useRef } from 'react';
import { Message, MessageItem } from './Message';

// VS Code 在 Webview 里注入 vscode 全局对象
declare const vscode: {
  postMessage: (msg: any) => void;
};

interface SlashCmd {
  name: string;
  description: string;
  argsHint?: string;
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [slashCommands, setSlashCommands] = useState<SlashCmd[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 监听 Extension 发来的消息
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case 'text':
          // 流式文本：追加到最后一条 assistant 消息
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
        case 'slash_commands':
          // Extension 推送可用 slash command 列表
          setSlashCommands(msg.commands || []);
          break;
        case 'status':
          // 状态消息显示在底部（不计入对话历史）
          if (msg.content === 'ready') {
            // 忽略 initial ready
          }
          break;
      }
    };

    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handler);
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setIsStreaming(true);

    // ⭐ slash command 走独立通道（/test /commit /notes /solve）
    if (text.startsWith('/')) {
      vscode.postMessage({ type: 'slash_command', content: text });
    } else {
      vscode.postMessage({ type: 'user_input', content: text });
    }
  }

  return (
    <div className="chat-panel">
      <div className="messages">
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
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="输入任务（如：把 main.py 改成 async），或 /test /commit /notes /solve"
          disabled={isStreaming}
        />
        <button onClick={handleSend} disabled={isStreaming || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  );
}