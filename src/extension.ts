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
import { registerAutoTest, runProjectTests } from './features/autoTest';
import { registerZhCommit } from './features/zhCommit';
import { registerNotes } from './features/notes';
import { setBuiltinStopCheck } from './agent/hooks/manager';
import { ChatPanel } from './webview/panel';
import { registerDoctor } from './commands/doctor';
import { registerSessionCommands } from './commands/sessions';
import { registerTracesCommand } from './commands/traces';
import {
  loadApprovalTier,
  registerPermissionCommands,
} from './commands/permissions';
import { resetApprovals } from './agent/tools/approval';
import { setWorkspaceRoot } from './agent/tools/paths';
import {
  McpManager,
  setMcpManager,
  getMcpManager,
} from './agent/mcp/manager';
import {
  collectMcpConfigs,
  GLOBAL_MCP_CONFIG,
} from './agent/mcp/config';
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

  // ⭐ 三档权限：先把设置里的档位读进权限模块，
  //   否则用户在设置界面/状态栏切了档，工具层根本不知道。
  loadApprovalTier(context);

  // ─────────────────────────────────────────────────────────
  // ⭐⭐ 启动 MCP 服务器
  //
  //   MCP（Model Context Protocol）= 让 agent 接入外部工具的统一标准。
  //   本项目只做 stdio 传输（本地进程），覆盖 VS Code 生态里
  //   绝大多数本地 MCP server（filesystem / git / postgres …）。
  //
  //   配置来源（后者覆盖前者）：
  //     · <globalStorageUri>/mcp.json          —— 换仓库也保留
  //     · <workspaceRoot>/.vscode/mini-coder-mcp.json —— 团队共享（提交进 git）
  //
  //   ⚠️ 设计原则：【一个服务器挂掉不能影响其他的】
  //     比喻：外卖少点一家，不影响吃饭。
  //     用户装了个 MCP 结果 agent 都不能用了，比不装还糟。
  //
  //   ⚠️ 启动失败【不阻塞激活】—— MCP 是可选增强，不是必需品。
  // ─────────────────────────────────────────────────────────
  const mcpManager = new McpManager();
  setMcpManager(mcpManager);
  context.subscriptions.push({
    dispose: () => {
      void mcpManager.stopAll();
    },
  });

  const mcpConfigs = collectMcpConfigs(
    wsRoot ?? null,
    context.globalStorageUri.fsPath
      ? `${context.globalStorageUri.fsPath}/${GLOBAL_MCP_CONFIG}`
      : undefined,
  );

  if (mcpConfigs.length === 0) {
    info('MCP：未配置任何服务器（可在 .vscode/mini-coder-mcp.json 里配置）');
  } else {
    try {
      const results = await mcpManager.startAll(mcpConfigs);
      const ok = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      const toolCount = ok.reduce((n, r) => n + r.toolCount, 0);
      info(
        `MCP：${ok.length}/${results.length} 个服务器启动成功，提供 ${toolCount} 个工具`,
      );
      for (const f of failed) {
        info(`MCP：服务器 "${f.name}" 启动失败（已跳过）—— ${f.error}`);
      }
    } catch (e: any) {
      // MCP 启动失败绝不能影响扩展激活
      logError(`MCP 启动异常（已忽略）: ${e?.message || e}`);
    }
  }

  // 注册 3 个特色
  registerAutoTest(context, configManager);
  registerZhCommit(context, configManager);
  registerNotes(context);

  // ⭐⭐ 注册内置的 Stop hook —— "测试没过就不许收工"
  //
  //   这是 hook 机制的第一个消费者，也是它最能证明价值的地方：
  //   agent 说"我做完了"的时候，先跑一遍项目测试，
  //   没过就把它打回去继续干。
  //
  //   原来"自动跑测试"只有一条写死的链路（autoTest.ts 的文件监听），
  //   那是"保存文件后"触发的；
  //   现在多了"回合结束前"这一道 —— 覆盖的是 agent 自己收工的时刻。
  //
  //   ⚠️ 用【注册制】而不是直接 import：
  //      autoTest.ts 依赖 AgentLoop，而 AgentLoop 依赖 hook manager ——
  //      直接 import 就成了循环依赖。注册制把依赖方向掰成单向。
  const stopAutoTest = vscode.workspace
    .getConfiguration('mini-coder')
    .get<boolean>('hooks.stopAutoTest', false);

  if (stopAutoTest) {
    setBuiltinStopCheck(async () => {
      const r = await runProjectTests();
      if (r.failed === 0) {
        return { ok: true, message: '' };
      }
      return {
        ok: false,
        message:
          `[内置 Stop hook] 项目测试没通过（${r.failed}/${r.total} 失败）。\n` +
          `测试命令：${r.testCommand}\n\n` +
          `${r.output.slice(0, 3000)}\n\n` +
          `请修复失败的地方后重试。`,
      };
    });
    info('内置 Stop hook 已启用：测试没过不许收工');
  }

  // ⭐ 注册正式的环境自检命令（原来只有 /doctor，用户不知道存在）
  registerDoctor(context, configManager);

  // ⭐ 注册会话管理命令（恢复历史 / 列出历史）
  registerSessionCommands(context);

  // ⭐ 注册调用链追踪命令（OpenTelemetry 风格的 span 树）
  //   跟 slash command `/traces` 共用同一套渲染。
  registerTracesCommand(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.reloadSession', () => {
      ChatPanel.currentPanel?.reloadFromDisk();
    }),
  );

  // ⭐ 状态栏入口
  //   修复记录（2026-10-21）：RUN.md 第 33 行写着"主窗口右下角状态栏会弹出
  //   Mini-Coder 激活提示"，但整个项目从来没有 createStatusBarItem —— 照着
  //   RUN.md 走验证清单的人会以为插件坏了。现在把这个入口补上。
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(sparkle) Mini-Coder';
  statusBar.tooltip = new vscode.MarkdownString(
    '**Mini-Coder AI 编程助手**\n\n' +
      '点击打开聊天面板\n\n' +
      '常用命令：`/test` `/commit` `/notes` `/doctor` `/undo`',
  );
  statusBar.command = 'mini-coder.openChat';
  statusBar.show();
  context.subscriptions.push(statusBar);
  info('状态栏入口已注册：Mini-Coder');

  // ⭐ 权限档位状态栏（紧挨着上面那个，点一下就切档）
  //   为什么单独开一项而不是把权限塞进聊天面板：
  //   权限是一个"随时可能需要改的安全开关"，必须在任何界面下都能一眼看到、
  //   一点就改。藏在聊天面板里等于没有。
  const permBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  permBar.command = 'mini-coder.setApprovalMode';
  context.subscriptions.push(permBar);
  registerPermissionCommands(context, permBar);
  info('权限档位状态栏已注册');

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
  // ⭐ MCP 服务器的子进程要杀掉 —— 否则会留下孤儿 node 进程
  void getMcpManager()?.stopAll();
  setMcpManager(null);
}