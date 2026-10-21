/**
 * 三档权限的 UI 接线
 *
 * 权限逻辑在 agent/tools/approval.ts，这里只管三件事：
 *   1. 激活时把设置里的档位读进来（不然用户在设置界面改了也没人听）
 *   2. 提供一个 QuickPick 让用户切档（比去设置界面翻 JSON 快）
 *   3. 把当前档位显示在状态栏和 /doctor 上
 *
 * ⚠️ 为什么档位要同时存"设置界面"和"globalState"：
 *   设置界面（ConfigurationTarget.Global）能被 settings.json 管理、能在多机同步，
 *   是最终事实来源；globalState 只是给"设置界面没碰过"时的默认值兜底。
 *   优先级永远是 设置界面 > globalState > 'askWrites'。
 */

import * as vscode from 'vscode';
import {
  ApprovalTier,
  TIER_INFO,
  ALL_TIERS,
  isApprovalTier,
  setApprovalTier,
  getApprovalTier,
} from '../agent/tools/approval';
import { info } from '../logger';

const STATE_APPROVAL_TIER = 'miniCoderApprovalTier';
const CONFIG_SECTION = 'mini-coder';

/**
 * 激活时调用：把生效的档位同步进权限模块
 *
 * 为什么不直接读一次就完事：设置界面改了之后不会自动生效，
 * 所以除了激活时读一次，还要监听 onDidChangeConfiguration。
 */
export function loadApprovalTier(context: vscode.ExtensionContext): ApprovalTier {
  const tier = resolveTier(context);
  setApprovalTier(tier);
  info(`权限档位：${TIER_INFO[tier].label} —— ${TIER_INFO[tier].summary}`);
  return tier;
}

function resolveTier(context: vscode.ExtensionContext): ApprovalTier {
  try {
    const fromSettings = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string>('approvalMode');
    if (isApprovalTier(fromSettings)) return fromSettings;
  } catch {
    // 设置读不到就往下走
  }

  const saved = context.globalState.get<ApprovalTier>(STATE_APPROVAL_TIER);
  if (isApprovalTier(saved)) return saved;

  return 'askWrites';
}

/** 持久化到设置界面（最终事实来源）+ globalState 兜底 */
export async function persistApprovalTier(
  context: vscode.ExtensionContext,
  tier: ApprovalTier,
): Promise<void> {
  setApprovalTier(tier);
  try {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update('approvalMode', tier, vscode.ConfigurationTarget.Global);
  } catch {
    // 设置写入失败（比如用户在只读 settings.json 环境）不影响本次会话生效
  }
  await context.globalState.update(STATE_APPROVAL_TIER, tier);
  info(`权限档位已切换：${TIER_INFO[tier].label}`);
}

/** 状态栏 / /doctor 用的一行摘要 */
export function tierSummary(tier: ApprovalTier = getApprovalTier()): string {
  return `${TIER_INFO[tier].label} · ${TIER_INFO[tier].summary}`;
}

/**
 * 权限面板内容（/permissions 和设置界面里都复用这一段）
 *
 * ⭐ 特意把"只读工具任何档位都不问"这件事讲出来：
 *   用户最常见的担心是"那我看文件会不会一直弹窗"。
 *   明确说清"只读永远不问"，他才敢选最严的那一档。
 */
export function tierReport(tier: ApprovalTier = getApprovalTier()): string {
  const lines: string[] = [];
  lines.push('**权限档位**');
  lines.push('');
  for (const t of ALL_TIERS) {
    const info_ = TIER_INFO[t];
    const mark = t === tier ? '👉 **当前**' : '　 ';
    lines.push(`${mark} **${info_.label}**　${info_.summary}`);
  }
  lines.push('');
  lines.push('**通用规则**');
  lines.push('');
  lines.push('- 只读操作（读文件 / 搜索 / 列目录）在任何档位都不弹窗。');
  lines.push('- 改文件的操作都有 checkpoint 存档，改错了可以 `/undo` 退回。');
  lines.push('- 你也可以随时用 `settings.json` 里的 `mini-coder.approvalMode` 直接改。');
  lines.push('');
  lines.push(`当前：**${TIER_INFO[tier].label}** —— ${TIER_INFO[tier].detail}`);
  return lines.join('\n');
}

/**
 * 注册「切换权限档位」命令
 *
 * 同时在两处暴露：
 *   - VS Code 命令面板（命令面板 → Mini-Coder: 权限档位）
 *   - 状态栏那一项（点一下直接打开这个 QuickPick）
 */
export function registerPermissionCommands(
  context: vscode.ExtensionContext,
  statusBarItem?: vscode.StatusBarItem,
): void {
  const refresh = () => {
    if (!statusBarItem) return;
    const t = getApprovalTier();
    // 图标也跟着变：只读档一眼能看出来，不能只靠文字
    const icon = t === 'readOnly' ? '$(eye)' : t === 'askAll' ? '$(shield)' : '$(shield-half)';
    statusBarItem.text = `${icon} ${TIER_INFO[t].label}`;
    statusBarItem.tooltip = new vscode.MarkdownString(
      `**Mini-Coder 权限：${TIER_INFO[t].label}**\n\n` +
        `${TIER_INFO[t].summary}\n\n` +
        '**只读操作在任何档位都不弹窗。**\n\n' +
        '点击切换档位',
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.setApprovalMode', async () => {
      const picked = await vscode.window.showQuickPick(
        ALL_TIERS.map((t) => ({
          label: `${t === getApprovalTier() ? '$(check) ' : ''}${TIER_INFO[t].label}`,
          description: TIER_INFO[t].summary,
          detail: t === getApprovalTier() ? '← 当前档位' : undefined,
          tier: t,
        })),
        { placeHolder: '选择 Mini-Coder 的权限档位' },
      );
      if (!picked) return;

      await persistApprovalTier(context, picked.tier);
      refresh();
      vscode.window.showInformationMessage(`✓ 权限档位已切换为「${TIER_INFO[picked.tier].label}」`);
    }),
  );

  // 设置界面里改了也要立刻生效，否则用户会以为设置项又是假的
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(`${CONFIG_SECTION}.approvalMode`)) return;
      loadApprovalTier(context);
      refresh();
    }),
  );

  refresh();
}