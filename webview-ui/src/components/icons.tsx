/**
 * 图标集 —— 16px 单线（monoline）风格
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么不用 emoji
 *
 *   原版 UI 满屏 emoji：👋🤔💬⏹🗑📂📋📦📖✏️🔧⚡🔨
 *   问题不是"不好看"，是**它们不构成一套视觉语言**：
 *     · 尺寸不一致（在 11px 正文里会糊成一团）
 *     · 风格不一致（有的彩色、有的单色、有的有底色）
 *     · 跨平台渲染不一致（Windows 上 Segoe UI Emoji 和 macOS 上不一样）
 *     · 无法用 CSS 控制颜色和粗细
 *
 *   换成 SVG 之后：
 *     · 全部 16×16 网格、1.4px 描边、粗细统一
 *     · 颜色跟随 currentColor（跟着主题走）
 *     · 缩放不失真
 *
 *   一句话：**emoji 是"借来的图标"，SVG 是"这个产品的图标"。**
 * ─────────────────────────────────────────────────────────────
 *
 * 约定：
 *   · viewBox 统一 0 0 16 16
 *   · 全部 fill=none + stroke=currentColor（实心例外：点、停止按钮）
 *   · 描边端点圆角（strokeLinecap=round），小尺寸下不扎眼
 *   · 所有图标 aria-hidden —— 它们是装饰，语义由旁边的文字承担
 */

import React from 'react';

export interface IconProps {
  size?: number;
  className?: string;
}

/**
 * ⭐ 描边宽度随尺寸反向缩放
 *
 *   SVG 的 strokeWidth 是【用户单位】，会跟着图标一起放大。
 *   于是同一个 `strokeWidth={1.4}`：
 *     · 14px 的小图标 → 实际 1.2px ✔ 刚好
 *     · 38px 的大图标 → 实际 3.3px ✘ 糊成一坨实心块
 *
 *   所以这里按 `weight * 16 / size` 反算：
 *   无论图标多大，渲染出来都是 weight 像素（默认 1.4px）。
 *
 *   这就是 UI 设计里说的「视觉尺寸一致」——
 *   一套图标放大缩小，线的粗细不该跟着变。
 */
function svgProps({ size = 16, className, weight = 1.4 }: IconProps & { weight?: number }) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: (weight * 16) / size,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };
}

/**
 * ⭐ 品牌标记 —— 圆角方框里的终端提示符 `>_`
 *
 * 为什么是它：
 *   这个产品干的事就是"接指令 → 干活"。
 *   `>_` 是所有人一眼就懂的终端符号，方框给它一个"应用"的身份感。
 *   尺寸缩小到 18px 依然认得出（这是 favicon 级别的小尺寸）。
 */
export function IconMark({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className, weight: 1.5 })}>
      <rect x="1.7" y="1.7" width="12.6" height="12.6" rx="3.4" />
      <path d="M4.9 5.9 6.9 8l-2 2.1" />
      <path d="M8.8 10.2h2.4" />
    </svg>
  );
}

/** 读文件 */
export function IconFile({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <path d="M9.2 2H4.7a1.4 1.4 0 0 0-1.4 1.4v9.2a1.4 1.4 0 0 0 1.4 1.4h6.6a1.4 1.4 0 0 0 1.4-1.4V5.2z" />
      <path d="M9.2 2v3.2h3.3" />
      <path d="M5.8 8.5h4.4M5.8 10.9h2.9" />
    </svg>
  );
}

/** 写文件 */
export function IconPencil({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <path d="M11.4 2.4 13.6 4.6 6.1 12.1 2.9 13l.9-3.2z" />
      <path d="M10.1 3.7 12.3 5.9" />
    </svg>
  );
}

/** 打补丁（diff） */
export function IconDiff({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <path d="M4.6 2.4v11.2" />
      <path d="M4.6 4.2h6.1a1.5 1.5 0 0 1 1.5 1.5v7.6a1.5 1.5 0 0 1-1.5 1.5H4.6" />
      <path d="M7.3 8.9h3.4M9 7.2v3.4" />
    </svg>
  );
}

/** 执行命令 */
export function IconTerminal({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <rect x="1.8" y="2.7" width="12.4" height="10.6" rx="1.8" />
      <path d="M4.9 6.3 6.8 8l-1.9 1.7" />
      <path d="M8.7 10h3.1" />
    </svg>
  );
}

/** 通用工具（滑块形态） */
export function IconTool({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <path d="M3.2 4.4h9.6M3.2 8h9.6M3.2 11.6h9.6" />
      <circle cx="6.2" cy="4.4" r="1.5" />
      <circle cx="10" cy="8" r="1.5" />
      <circle cx="5.2" cy="11.6" r="1.5" />
    </svg>
  );
}

/** 成功 */
export function IconCheck({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className, weight: 1.7 })}>
      <path d="M3.2 8.4 6.3 11.5 12.8 4.9" />
    </svg>
  );
}

/** 失败 */
export function IconCross({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className, weight: 1.6 })}>
      <path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" />
    </svg>
  );
}

/** 停止（实心方块，和线性图标刻意区分） */
export function IconStop({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 发送（箭头） */
export function IconSend({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <path d="M2.8 8h10.4" />
      <path d="M9 3.8 13.2 8 9 12.2" />
    </svg>
  );
}

/** 插话（对话气泡） */
export function IconChat({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <path d="M13.6 9.1a1.7 1.7 0 0 1-1.7 1.7H5.4l-3 3.1V4.3a1.7 1.7 0 0 1 1.7-1.7h7.8a1.7 1.7 0 0 1 1.7 1.7z" />
    </svg>
  );
}

/** 新建 */
export function IconPlus({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <path d="M8 3.4v9.2M3.4 8h9.2" />
    </svg>
  );
}

/** 删除 */
export function IconTrash({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <path d="M2.9 4.3h10.2" />
      <path d="M6.4 4.3V3.1a.9.9 0 0 1 .9-.9h1.4a.9.9 0 0 1 .9.9v1.2" />
      <path d="M4.3 4.3l.6 8.3a.9.9 0 0 0 .9.8h4.4a.9.9 0 0 0 .9-.8l.6-8.3" />
    </svg>
  );
}

/** 历史 */
export function IconHistory({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <circle cx="8" cy="8" r="5.7" />
      <path d="M8 4.9V8l2.1 1.5" />
    </svg>
  );
}

/** 展开 / 收起 */
export function IconChevron({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <path d="M6.3 3.7 10.5 8l-4.2 4.3" />
    </svg>
  );
}

/** 警告 */
export function IconAlert({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <path d="M8 2.7 14.3 13.3H1.7z" />
      <path d="M8 6.7v3" />
      <circle cx="8" cy="11.5" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 加载中（CSS 里旋转） */
export function IconSpinner({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <path d="M8 1.9a6.1 6.1 0 1 1-6.1 6.1" />
    </svg>
  );
}

/** 清单 */
export function IconList({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps({ size, className })}>
      <path d="M6 4.1h7.6M6 8h7.6M6 11.9h7.6" />
      <circle cx="2.9" cy="4.1" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="2.9" cy="8" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="2.9" cy="11.9" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * 按工具名挑图标
 *
 * 为什么按名字匹配而不是维护一张映射表：
 *   工具名是模型和扩展之间约定的字符串（MCP 工具还是 `mcp__server__tool` 形态），
 *   按关键字匹配能自动覆盖新加的工具，不用改前端。
 */
export function ToolIcon({ name, size = 14 }: { name: string; size?: number }) {
  const n = (name || '').toLowerCase();
  if (n.includes('read') || n.includes('list') || n.includes('glob')) return <IconFile size={size} />;
  if (n.includes('write') || n.includes('note')) return <IconPencil size={size} />;
  if (n.includes('patch') || n.includes('restore')) return <IconDiff size={size} />;
  if (n.includes('shell') || n.includes('exec') || n.includes('run')) return <IconTerminal size={size} />;
  if (n.includes('todo')) return <IconList size={size} />;
  return <IconTool size={size} />;
}
