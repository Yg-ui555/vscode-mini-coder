/**
 * 消息渲染
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 三种角色的三种待遇
 *
 *   用户（指令）  → 带节点的**卡片**，节点是强调色实心
 *                  语义："这是你下的令，agent 从这里开始干活"
 *
 *   Agent（操作）  → 挂在同一根竖线上的**操作节点**
 *                  语义："这是它干的事，每一件都可查、可展开"
 *
 *   Agent（正文）  → **无气泡的通栏排版**
 *                  语义："这是它想说的话"
 *
 *   为什么正文不装在气泡里：
 *   气泡是"消息"的视觉语言，但 agent 的正文其实是**一份文档**
 *   （结论、解释、代码片段）。把文档塞进气泡里，行宽被压窄、
 *   留白被挤掉，长回答读起来憋屈。通栏排版能到 70~80 字符一行，
 *   那才是长时间阅读的舒适行宽。
 *
 * ─────────────────────────────────────────────────────────────
 */

import { OperationList, ToolEvent } from './OperationList';
import { IconAlert, IconList } from './icons';

export type { ToolEvent };

export interface Message {
  role: 'user' | 'assistant' | 'error';
  content: string;
  tools?: ToolEvent[];
  /**
   * ⭐ 双可见性：这条消息已被上下文压缩，模型看不到了，
   *   但用户仍可回看 —— 所以灰显 + "已压缩"角标。
   *
   *   类比：档案柜里的一份旧卷宗，已经不再发给模型了，
   *   但你随时能翻出来核对。
   */
  compacted?: boolean;
}

export function MessageItem({
  message,
  streaming = false,
}: {
  message: Message;
  streaming?: boolean;
}) {
  if (message.role === 'user') {
    return <Directive text={message.content} compacted={message.compacted} />;
  }

  if (message.role === 'error') {
    return (
      <div className="mc-error">
        <span className="mc-error-icon">
          <IconAlert size={14} />
        </span>
        <div className="mc-error-body">{message.content}</div>
      </div>
    );
  }

  const hasOps = !!message.tools && message.tools.length > 0;
  const hasText = !!message.content && message.content.trim().length > 0;

  if (!hasOps && !hasText) return null;

  return (
    <div className={`mc-turn${message.compacted ? ' compacted' : ''}`}>
      {message.compacted && (
        <div className="mc-compacted-badge" title="这段对话已被上下文压缩，模型只看到摘要，你仍可回看">
          <IconList size={11} />
          已压缩
        </div>
      )}
      {hasOps && <OperationList tools={message.tools!} streaming={streaming} />}
      {hasText && <div className="mc-prose">{message.content}</div>}
    </div>
  );
}

/**
 * 用户指令卡片
 *
 * 用卡片而不是气泡，是因为它是**一个要被引用的对象**
 * （"按我刚才说的那个改"），卡片有边界、可以被复制、
 * 未来还能挂"编辑""重发"这类操作。
 */
function Directive({ text, compacted }: { text: string; compacted?: boolean }) {
  return (
    <div className={`mc-directive${compacted ? ' compacted' : ''}`}>
      <span className="mc-directive-node" aria-hidden="true" />
      <div className="mc-directive-card">
        <div className="mc-eyebrow">你的指令</div>
        <div className="mc-directive-text">{text}</div>
      </div>
    </div>
  );
}
