/**
 * 权限分级 —— 用户对"AI 要动我的代码"的知情权与控制权
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 三档权限（2026-10-21）
 *
 *   readOnly    只读。agent 只能读文件、搜索、列目录，一根手指都动不了。
 *               适合：先用它当"能读代码的搜索引擎"用，不信任它的判断时。
 *
 *   askWrites   （默认）只读操作自动放行；改文件要确认；
 *               执行 shell 命令只有在【命中高危特征】时才确认。
 *               适合：日常写代码。改文件本来就有 checkpoint 兜底，
 *               所以确认一次就够；命令只在真的会出事时才打断你。
 *
 *   askAll      最严。只读操作自动放行；改文件要确认；
 *               每一条 shell 命令都逐条确认。
 *               适合：让 agent 跑构建/跑测试，你不想它顺手执行任何其他东西。
 *
 * 三档的共同点：**只读工具在任何档位都不问**。
 *   每读一个文件弹一次窗，这个工具会立刻变得没法用——
 *   用户的反应不是"更安全了"，而是"烦死了，全关了"，最后安全形同虚设。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 为什么不学 goose 的 LLM-as-judge 权限判定
 *   （goose/crates/goose/src/permission/permission_judge.rs）
 *
 *   它在每次工具调用前额外调一次 LLM 判断"这操作是不是只读"。
 *   三个问题：
 *     慢——每个工具调用多一次完整 LLM 往返，工具密集的任务延迟翻倍；
 *     烧钱——同样的往返在评测里是实打实的 token 成本；
 *     判不准——它也只是猜，而猜错的方向恰恰是最危险的方向。
 *   goose 团队自己都主要靠静态标注兜底。所以这里用 ToolMeta.kind 静态判定。
 *
 * ─────────────────────────────────────────────────────────────
 * 类比：三档就是三种「钥匙的发放范围」
 *   readOnly  = 只给了门厅的钥匙，看得见客厅，进不去
 *   askWrites = 给了钥匙，但开锁前会敲一下门
 *   askAll    = 给了钥匙，每开一次门都敲一下
 */

import * as vscode from 'vscode';
import { ToolMeta } from './meta';
import { FileDiff, renderUnifiedDiff, renderCompactPreview, summarizeDiffs } from '../../util/diff';

interface VscodeLike {
  window: {
    showWarningMessage: (
      message: string,
      ...items: any[]
    ) => Thenable<string | undefined>;
    /** 打开 diff 预览文档用（测试环境可能没有 → 全部可选链保护） */
    showTextDocument?: (doc: any, options?: any) => Thenable<any>;
  };
  workspace?: {
    openTextDocument?: (options: any) => Thenable<any>;
  };
}

/** 权限档位 */
export type ApprovalTier = 'readOnly' | 'askWrites' | 'askAll';

export const ALL_TIERS: ApprovalTier[] = ['readOnly', 'askWrites', 'askAll'];

export interface TierInfo {
  /** 中文名，UI 里显示 */
  label: string;
  /** 一句话说明这一档到底拦什么 */
  summary: string;
  /** 状态栏/提示里用的一句话 */
  detail: string;
}

export const TIER_INFO: Record<ApprovalTier, TierInfo> = {
  readOnly: {
    label: '只读',
    summary: 'agent 只能读文件和搜索，改文件、跑命令一律拒绝。',
    detail: '只读 · 不能改任何文件',
  },
  askWrites: {
    label: '写入需确认',
    summary: '改文件要确认；跑命令只在命中高危特征时确认。',
    detail: '写入需确认 · 高危命令才问',
  },
  askAll: {
    label: '全部需确认',
    summary: '改文件要确认，每一条 shell 命令都逐条确认。',
    detail: '全部需确认 · 每条命令都问',
  },
};

export function isApprovalTier(v: unknown): v is ApprovalTier {
  return typeof v === 'string' && (ALL_TIERS as string[]).includes(v);
}

/** 当前档位 */
let tier: ApprovalTier = 'askWrites';

export function setApprovalTier(t: ApprovalTier): void {
  tier = t;
}

export function getApprovalTier(): ApprovalTier {
  return tier;
}

/**
 * 非交互模式（单测 / 评测沙箱）
 *
 * ⚠️ 之前这里叫 setApprovalMode('ask' | 'auto')，和上面的三档 tier
 *   名字太像了，很容易在维护时搞混——一个是非交互开关，一个是权限档位。
 *   所以改名为 setNonInteractive(boolean)，语义一眼可见。
 *
 * 为什么要这个逃生舱：单测里 vscode 的 showWarningMessage 一律返回 undefined，
 * 不放行的话所有写工具测试都会挂；评测沙箱里更是不能弹窗打断。
 */
let nonInteractive = false;

export function setNonInteractive(on: boolean): void {
  nonInteractive = on;
}

export function isNonInteractive(): boolean {
  return nonInteractive;
}

/** 本次会话已授权的工具（key = 工具名） */
const sessionApprovals = new Set<string>();

/** 首次运行还没问过的工具（只问一次，之后记到 sessionApprovals） */
const askedTools = new Set<string>();

/**
 * 拿 vscode 的弹窗能力
 *
 * ⚠️ 这里原来是运行时 `require('vscode')` + try/catch 兜底，理由是"单测里没有 vscode 就放行"。
 *   但那是个假想的安全网：
 *     · vitest 下 require('vscode') 走不通（transform 后不是真 CommonJS），直接返回 undefined
 *       → 所有弹窗分支被静默跳过 → 权限逻辑整块永远没被执行过
 *     · 也就是说"权限到底拦没拦住"这件事，在测试里从来没被真正验证过
 *
 *   现在改成静态 import（和 doctor.ts / config.ts 一致）：
 *     · 真实 VS Code：正常
 *     · vitest：vitest.config.mts 把 vscode 别名指向 stub，能拿到假弹窗
 *     · 评测 CLI：src/eval/shim.ts 劫持 Module._resolveFilename，静态 import 一样被替换
 *
 *   拿不到就当"非交互环境"放行，这一条仍然保留。
 */
function safeVscode(): VscodeLike | undefined {
  try {
    return vscode as unknown as VscodeLike;
  } catch {
    return undefined;
  }
}

/** 新会话开始时调用，清空授权记录 */
export function resetApprovals(): void {
  sessionApprovals.clear();
  askedTools.clear();
}

/** 供测试用：查询当前授权状态 */
export function isApproved(toolName: string): boolean {
  return sessionApprovals.has(toolName);
}

export interface ApprovalDecision {
  approved: boolean;
  /** 拒绝原因 —— 会原样回给 LLM，让它知道是被权限挡了而不是工具坏了 */
  reason?: string;
  /** 这次是否真的弹了窗 */
  prompted: boolean;
}

const OK = (): ApprovalDecision => ({ approved: true, prompted: false });

/** LLM 能看懂的拒绝话术：说清是哪一档挡的、还有别的办法吗 */
function denyBecause(t: ApprovalTier, toolName: string): ApprovalDecision {
  return {
    approved: false,
    prompted: false,
    reason:
      `工具 ${toolName} 被权限设置拒绝：当前是【${TIER_INFO[t].label}】档，${TIER_INFO[t].summary}\n` +
      `这不是工具故障，是用户设的限制。请换一种做法（比如只读方式先给出方案让用户自己改），` +
      `不要反复重试同一个调用，也不要试图用别的工具绕过。`,
  };
}

/**
 * ⭐ 权限决策的唯一入口
 *
 * 之前每个工具自己判断要不要弹窗，逻辑散在 4 个文件里，
 * 加档位的时候必然漏。这里收拢成一个函数，新增工具只要给对 ToolMeta 就自动受管。
 */
export async function approveToolCall(req: {
  toolName: string;
  meta: ToolMeta;
  /** 给用户看的摘要（一句话说清要干什么） */
  summary: string;
  /** exec 类工具传原始命令，用于高危特征检测 */
  command?: string;
  /**
   * 这一次调用本身风险偏低吗？（比如 write_file 新建文件而不是覆盖）
   *
   * 语义很明确，别扩大用：
   *   askWrites 档 → 免打扰，直接放行
   *   readOnly 档 → 照拦（新建文件同样是在动工作区）
   *   askAll 档   → 照问（既然选了最严，就别在这儿开后门）
   *
   * 为什么需要它：write_file 新建文件和覆盖文件的风险差一个量级，
   * 但只读档的语义是"一根手指都不许动"，两者不能用同一个布尔判断。
   */
  lowRisk?: boolean;
  /**
   * 改动预览（apply_patch / write_file 传入）
   *
   * 传了就走"显示 diff"的交互；不传就是原来的纯文字确认。
   * 详见下方 write 分支的注释。
   */
  preview?: FileDiff[];
}): Promise<ApprovalDecision> {
  const { toolName, meta, summary, command, lowRisk, preview } = req;

  // 逃生舱优先：非交互环境一律放行
  if (nonInteractive) return OK();

  // 只读在任何档位都放行 —— 否则这个工具会因为太烦而被直接关掉
  if (meta.readOnly || meta.kind === 'read') return OK();

  const current = tier;

  // 只读档：非只读工具一律拒绝
  if (current === 'readOnly') return denyBecause(current, toolName);

  // 低风险调用在 askWrites 档免打扰（只读档已经在上面被拦掉了）
  if (lowRisk && current === 'askWrites') return OK();

  const vscode = safeVscode();
  // 没有 vscode（单测 / 评测）→ 放行，避免测试全卡住
  if (!vscode) return OK();

  if (meta.kind === 'exec') {
    const danger = command ? detectDangerousCommand(command) : undefined;

    // askWrites 档：只有命中高危特征才打断
    if (current === 'askWrites' && !danger) return OK();

    const message = danger
      ? `⚠ 这条命令包含高危操作：${danger}\n\n${command}\n\n${summary}`
      : `Mini-Coder 准备执行命令\n\n${summary || command || ''}`;

    // ⭐ askAll 档下【不提供】"本次会话都允许"：
    //   执行命令的副作用在 agent 控制之外（可能已经推了远端、删了系统文件），
    //   一句"本次会话都允许"就把这一整类风险全开了，这个口子不该开。
    const action = await vscode.window.showWarningMessage(message, '允许一次', '拒绝', {
      modal: true,
    } as any);
    return action === '允许一次'
      ? { approved: true, prompted: true }
      : { ...denyBecause(current, toolName), prompted: true };
  }

  // write 类：走原来的按工具名记忆授权
  if (sessionApprovals.has(toolName)) return { approved: true, prompted: true };

  const isFirstAsk = !askedTools.has(toolName);
  const writeButtons = [
    '允许一次',
    ...(isFirstAsk ? ['本次会话都允许'] : []),
    '拒绝',
  ];

  // ── ⭐ 有 diff 预览时的交互（2026-10-22 新增）──
  //
  //   为什么需要：
  //     用户点"允许"之前只能看到"将修改 3 个文件"，看不到具体改哪行。
  //     本项目已经有【事后回滚】（checkpoint + /undo），
  //     但事后补救不能替代事前知情 —— 用户还是得先盲目地点一次允许。
  //
  //   为什么小改动内嵌、大改动走按钮：
  //     VS Code 的通知弹窗（showWarningMessage）只渲染两三行，
  //     把 50 行 diff 塞进去会撑爆排版，反而什么都看不清。
  //     所以：小改动直接显示（省一次点击），大改动只给统计 + 按钮。
  if (preview && preview.length > 0) {
    const stat = summarizeDiffs(preview);
    const compact = renderCompactPreview(preview, INLINE_DIFF_MAX_LINES);
    const changedLines = preview.reduce((n, d) => n + d.added + d.removed, 0);

    const inlineMessage =
      changedLines <= INLINE_DIFF_MAX_LINES
        ? `Mini-Coder 准备修改你的文件\n\n${summary}\n\n` +
            `📋 ${stat}\n\n${compact}\n\n`
        : `Mini-Coder 准备修改你的文件\n\n${summary}\n\n` +
            `📋 ${stat}（改动较多，完整 diff 点"查看改动"）\n\n`;

    let action = await vscode.window.showWarningMessage(inlineMessage, ...writeButtons, '查看改动');

    // 用户想看完整 diff → 打开只读文档 → 看完再问一次
    if (action === '查看改动') {
      const opened = await showDiffDocument(preview);
      if (opened) {
        action = await vscode.window.showWarningMessage(
          `已打开改动预览文档。确认要写入吗？\n\n📋 ${stat}`,
          '允许一次',
          ...(isFirstAsk ? ['本次会话都允许'] : []),
          '拒绝',
        );
      } else {
        // 打不开预览文档也不能卡住流程，退回原来的三选项
        action = await vscode.window.showWarningMessage(
          `无法打开改动预览（当前环境不支持）。确认要写入吗？\n\n📋 ${stat}`,
          '允许一次',
          ...(isFirstAsk ? ['本次会话都允许'] : []),
          '拒绝',
        );
      }
    }

    if (action === '本次会话都允许') {
      sessionApprovals.add(toolName);
      return { approved: true, prompted: true };
    }
    if (action === '允许一次') {
      askedTools.add(toolName);
      return { approved: true, prompted: true };
    }
    return { ...denyBecause(current, toolName), prompted: true };
  }

  const action = await vscode.window.showWarningMessage(
    `Mini-Coder 准备修改你的文件\n\n${summary}`,
    ...writeButtons,
  );

  if (action === '本次会话都允许') {
    sessionApprovals.add(toolName);
    return { approved: true, prompted: true };
  }
  if (action === '允许一次') {
    askedTools.add(toolName);
    return { approved: true, prompted: true };
  }

  return { ...denyBecause(current, toolName), prompted: true };
}

/**
 * 弹窗里内嵌显示的 diff 行数上限
 *
 * 超过这个数就只给统计 + "查看改动"按钮。
 * VS Code 通知弹窗渲染不了太多内容，硬塞只会糊成一团。
 */
const INLINE_DIFF_MAX_LINES = 15;

/**
 * 在编辑器里打开 diff 预览（只读，不进文件系统）
 *
 * 用 untitled 文档 + `diff` 语言：VS Code 会自动渲染成红绿对比视图，
 * 这比自己画一套 diff 好看得多，也不用引任何依赖。
 *
 * ⚠️ 打不开绝不能阻断审批：预览是增强，不是功能。
 *   测试环境（stub）里 openTextDocument 会 reject，这里必须兜住。
 */
async function showDiffDocument(preview: FileDiff[]): Promise<boolean> {
  const vscode = safeVscode();
  if (!vscode?.workspace?.openTextDocument || !vscode.window.showTextDocument) return false;

  try {
    const doc = await vscode.workspace.openTextDocument({
      content: renderUnifiedDiff(preview),
      language: 'diff',
    });
    await vscode.window.showTextDocument(doc, {
      preview: true,
      preserveFocus: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 危险 shell 命令检测（只读提示，不阻断）
 *
 * run_shell 能执行任意命令，这是能力最大的工具。
 * 完全靠路径白名单管不住它 —— 命令可以是 rm -rf。
 * 这里做的是"高危命令提示"，比 goose 的做法轻，
 * 但至少让用户在按下回车前看到一眼。
 *
 * 做成"提示"而不是"阻断"，是为了避免误伤：
 * 比如 "git commit --amend" 匹配不到危险词，
 * 但 "rm -rf /" 必须提示。
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+\//i, reason: '递归删除根目录' },
  { pattern: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i, reason: '递归强制删除' },
  { pattern: /\bdel\s+\/[sq]/i, reason: 'Windows 递归删除' },
  { pattern: /\bRemove-Item\b.*-Recurse.*-Force/i, reason: 'PowerShell 递归强制删除' },
  { pattern: /\bformat\s+[a-z]:/i, reason: '格式化磁盘' },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: 'fork 炸弹' },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b/i, reason: '关机/重启' },
  { pattern: /\bgit\s+push\s+.*--force(?!-with-lease)/i, reason: '强制推送（会覆盖远端历史）' },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: '硬重置（丢弃本地改动）' },
  { pattern: /\bchmod\s+-R\s+777\s+\//i, reason: '全局权限放开' },
];

/** 返回命中的危险原因，没命中返回 undefined */
export function detectDangerousCommand(command: string): string | undefined {
  if (!command) return undefined;
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return reason;
  }
  return undefined;
}

/**
 * 列出某个档位下会被拦住的工具（/doctor 和设置界面用）
 *
 * 纯函数，不碰 vscode，方便单测。
 */
export function blockedToolsIn(t: ApprovalTier, metas: Record<string, ToolMeta>): string[] {
  return Object.entries(metas)
    .filter(([, m]) => !m.readOnly && m.kind !== 'read')
    .filter(([, m]) => {
      if (t === 'readOnly') return true;
      if (t === 'askWrites') return m.kind === 'write';
      return true; // askAll：非只读全部要确认
    })
    .map(([name]) => name)
    .sort();
}