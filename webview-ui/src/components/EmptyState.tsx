/**
 * 空状态 —— 面板的"第一屏"
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 空状态不是"没内容"，是"给用户一个可以立刻动手的入口"
 *
 *   原版：👋 你好，我是 Mini-Coder + 三行例子 + 一堆 slash command + 一句提示
 *   问题：
 *     · emoji 开头像玩具
 *     · 例子是纯文本，**不能点**——用户还得手打一遍
 *     · slash command 和提示混在一起，密度高但没层次
 *
 *   现在：
 *     · 一句定位（说清楚它能干什么，而不是打招呼）
 *     · 三个可点击的示例（点了就填进输入框）
 *     · 快捷命令单独一块，两列对齐
 *
 *   一句话：**空屏是邀请，不是菜单。**
 * ─────────────────────────────────────────────────────────────
 */

import { IconChevron, IconMark } from './icons';

export interface SlashCmd {
  name: string;
  description: string;
  argsHint?: string;
}

interface EmptyStateProps {
  slashCommands: SlashCmd[];
  /** 点示例 → 把文本填进输入框（不直接发送，让用户先看一眼） */
  onPick: (text: string) => void;
}

const EXAMPLES = [
  '把 src 目录下重复的逻辑抽成一个公共模块',
  '给这个项目补一组覆盖边界条件的单元测试',
  '审查我当前的改动，找出潜在风险',
];

export function EmptyState({ slashCommands, onPick }: EmptyStateProps) {
  return (
    <div className="mc-empty">
      <IconMark size={38} className="mc-empty-mark" />

      <h1 className="mc-empty-title">把任务交给它</h1>
      <p className="mc-empty-desc">
        它会读代码、改文件、跑测试 —— 而且每一步都留下记录，随时能回看，也能一键撤销。
      </p>

      <div className="mc-empty-label">试试这些</div>
      <div className="mc-suggestions">
        {EXAMPLES.map((text) => (
          <button key={text} type="button" className="mc-suggestion" onClick={() => onPick(text)}>
            <IconChevron size={13} className="mc-suggestion-arrow" />
            <span>{text}</span>
          </button>
        ))}
      </div>

      {slashCommands.length > 0 && (
        <>
          <div className="mc-empty-label mc-empty-label-spaced">快捷命令</div>
          <div className="mc-cmds">
            {slashCommands.map((c) => (
              <div key={c.name} className="mc-cmd">
                <code>
                  /{c.name}
                  {c.argsHint ? ` ${c.argsHint}` : ''}
                </code>
                <span>{c.description}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
