/**
 * Mini-Coder 扩展入口
 *
 * 职责：
 * 1. 激活时检查 BYOK 配置
 * 2. 注册 3 个特色模块（autoTest / zhCommit / notes）
 * 3. 注册 5 个命令
 */

import * as vscode from 'vscode';
import { ConfigManager } from './config';
import { registerAutoTest } from './features/autoTest';
import { registerZhCommit } from './features/zhCommit';
import { registerNotes } from './features/notes';
import { ChatPanel } from './webview/panel';

let configManager: ConfigManager;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Mini-Coder 激活');

  configManager = new ConfigManager(context);

  // 注册 3 个特色
  registerAutoTest(context, configManager);
  registerZhCommit(context, configManager);
  registerNotes(context);

  // 注册设置 Key 命令
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.setApiKey', async () => {
      await configManager.promptAndSaveApiKey();
      const provider = await configManager.promptAndSaveProvider();
      if (provider) {
        vscode.window.showInformationMessage(`✓ Provider 已设置: ${provider}`);
      }
    }),
  );

  // 注册 Webview 聊天面板命令
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.openChat', () => {
      ChatPanel.createOrShow(context.extensionUri, configManager);
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
  ChatPanel.currentPanel?.dispose();
}