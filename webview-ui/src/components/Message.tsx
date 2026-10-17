/**
 * 消息渲染：用户消息、agent 文本、agent 工具调用卡片
 */

export interface ToolEvent {
  name: string;
  args: any;
  result?: string;
  isError?: boolean;
}

export interface Message {
  role: 'user' | 'assistant' | 'error';
  content: string;
  tools?: ToolEvent[];
}

export function MessageItem({ message }: { message: Message }) {
  if (message.role === 'user') {
    return <div className="message user">{message.content}</div>;
  }
  if (message.role === 'error') {
    return <div className="message error">⚠ {message.content}</div>;
  }
  return (
    <div className="message assistant">
      {message.content && (
        <div className="content">{message.content}</div>
      )}
      {message.tools?.map((t, i) => (
        <ToolCard key={i} tool={t} />
      ))}
    </div>
  );
}

function ToolCard({ tool }: { tool: ToolEvent }) {
  return (
    <div className="tool-card" style={{ borderLeftColor: getToolColor(tool.name) }}>
      <div className="tool-header">
        <span className="tool-icon">{getToolIcon(tool.name)}</span>
        <span className="tool-name">{tool.name}</span>
        {tool.result !== undefined && (
          <span className={`tool-status ${tool.isError ? 'error' : 'ok'}`}>
            {tool.isError ? '✗' : '✓'}
          </span>
        )}
      </div>
      <div className="tool-section">
        <div className="tool-label">参数</div>
        <pre>{JSON.stringify(tool.args, null, 2)}</pre>
      </div>
      {tool.result !== undefined && (
        <div className="tool-section">
          <div className="tool-label">结果</div>
          <pre>{tool.result.slice(0, 800)}{tool.result.length > 800 ? '...' : ''}</pre>
        </div>
      )}
    </div>
  );
}

function getToolIcon(name: string): string {
  if (name.includes('read')) return '📖';
  if (name.includes('write')) return '✏️';
  if (name.includes('patch')) return '🔧';
  if (name.includes('shell')) return '⚡';
  return '🔨';
}

function getToolColor(name: string): string {
  if (name.includes('read')) return '#4ade80';
  if (name.includes('write')) return '#60a5fa';
  if (name.includes('patch')) return '#fbbf24';
  if (name.includes('shell')) return '#f87171';
  return '#94a3b8';
}