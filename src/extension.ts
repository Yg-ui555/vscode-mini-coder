/**
 * Mini-Coder 扩展入口
 *
 * 职责：
 * 1. 激活时检查 BYOK 配置
 * 2. 注册 3 个特色模块（autoTest / zhCommit / notes）
 * 3. 注册 5+ 个命令（设置 key / 打开 chat / 复制日志 / 清空日志）
 * 4. 初始化日志通道（OutputChannel）
 */

import * as vscode from 'vscode';
import { ConfigManager } from './config';
import { registerAutoTest } from './features/autoTest';
import { registerZhCommit } from './features/zhCommit';
import { registerNotes } from './features/notes';
import { ChatPanel } from './webview/panel';
import { registerDoctor } from './commands/doctor';
import { resetApprovals } from './agent/tools/approval';
import { setWorkspaceRoot } from './agent/tools/paths';
import { initLogger, info, error as logError, getAllLogs, clearLogs } from './logger';

let configManager: ConfigManager;

export async function activate(context: vscode.ExtensionContext) {
  // 初始化日志通道（用户在"输出"面板 → "Mini-Coder" 可看）
  const logChannel = vscode.window.createOutputChannel('Mini-Coder');
  initLogger(logChannel);

  info('Mini-Coder 激活');
  configManager = new ConfigManager(context);

  // ⭐ 新增：把工作区根目录告诉工具层，让路径白名单生效。
  //   不设的话所有工具会退化成"不检查"，等于白名单没开。
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  setWorkspaceRoot(wsRoot);
  info(`工作区：${wsRoot ?? '（未打开文件夹，仅允许相对路径）'}`);

  // 注册 3 个特色
  registerAutoTest(context, configManager);
  registerZhCommit(context, configManager);
  registerNotes(context);

  // ⭐ 注册正式的环境自检命令（原来只有 /doctor，用户不知道存在）
  registerDoctor(context, configManager);

  // 注册设置 Key 命令
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.setApiKey', async () => {
      await configManager.promptAndSaveApiKey();
      const provider = await configManager.promptAndSaveProvider();
      if (provider) {
        vscode.window.showInformationMessage(`✓ Provider 已设置: ${provider}`);
        info(`Provider 已设置：${provider}`);
      }
    }),
  );

  // 注册 Webview 聊天面板命令
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.openChat', () => {
      info('用户打开了 Chat 面板');
      ChatPanel.createOrShow(context.extensionUri, context, configManager);
    }),
  );

  // 注册"一键复制日志"命令（出问题让用户直接粘贴给你）
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.copyLogs', async () => {
      const logs = getAllLogs();
      await vscode.env.clipboard.writeText(logs);
      vscode.window.showInformationMessage(
        `✓ 已复制 ${logs.split('\n').length} 条日志到剪贴板，直接粘贴发给开发者`,
      );
      info('用户复制了日志');
    }),
  );

  // 注册"清空日志"命令
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.clearLogs', () => {
      clearLogs();
      vscode.window.showInformationMessage('✓ 日志已清空');
    }),
  );

  // 注册"显示日志"命令（快捷打开 Mini-Coder 输出面板）
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.showLogs', () => {
      logChannel.show();
    }),
  );

  // 首次启动引导
  const hasKey = await configManager.getApiKey();
  if (!hasKey) {
    const action = await vscode.window.showInformationMessage(
      '欢迎使用 Mini-Coder！需要先配置 LLM API Key（BYOK 模式，零内置费用）',
      '立即设置',
      '稍后',
    );
    if (action === '立即设置') {
      await configManager.promptAndSaveApiKey();
      await configManager.promptAndSaveProvider();
    }
  }
}

export function deactivate() {
  info('Mini-Coder 停用');
  // 清掉本次会话的写操作授权记录，避免下次启动还残留
  resetApprovals();
  ChatPanel.currentPanel?.dispose();
}