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
import { registerDoctor, probeApi } from './commands/doctor';
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

/**
 * ⭐ 启动后自动打开面板的定时器句柄（2026-10-30 加）
 *
 *   为什么必须留着它：
 *     之前这里直接 `setTimeout(...)` 就把句柄扔了。
 *     扩展在 4 秒内被卸载（用户关窗口 / 重载 / 开发时反复 F5）的话，
 *     这个回调【照样会跑】—— 扩展都 deactivate 了，它还在
 *     executeCommand('mini-coder.openChat')，
 *     弹出一个没人要的空面板，还可能往已失效的 VS Code API 上发消息。
 *
 *   留句柄 + deactivate 里 clearTimeout = 卸载后不再有回调。
 */
let autoOpenTimer: ReturnType<typeof setTimeout> | undefined;

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

  // ⭐⭐ 启动体检（2026-10-29 加）
  //
  //   为什么要有：
  //     本项目被"配置项骗用户"坑过太多次 —— 面板显示 minimax、
  //     实际打的是 deepseek 的地址；/doctor 显示 key 已设置、
  //     真正发请求时取到的却是另一把。
  //
  //   所以每次启动都把"真正会生效的那一套"打进日志：
  //     provider 从哪来、model 是什么、key 从哪来（不打印 key 内容）、
  //     以及一次 max_tokens=1 的真实探测结果。
  //
  //   类比：汽车启动时仪表盘自检灯全亮一遍，
  //         你不用等到开上路才发现"油箱是空的"。
  //
  //   ⚠ 探测会真发一个 max_tokens=1 的请求（几分钱以内）。
  await logStartupHealth();

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

  // ⭐ 启动后自动打开聊天面板（2026-10-28）
  //
  //   为什么要有这个开关：
  //     面板是 webview，最难查的故障就是"打开后一片白" ——
  //     没有 stack trace、没有 error log，屏幕上只有空白。
  //     有这个开关，冒烟测试和排障就能自动打开面板取证，不用人工点状态栏。
  //
  //   两个开关都关时，行为与没装这个扩展完全一致（默认状态）。
  //   环境变量优先于设置项（CI / 排障时不想改用户设置时用环境变量更方便）。
  const openOnStartup =
    vscode.workspace.getConfiguration('mini-coder').get<boolean>('openOnStartup') === true ||
    process.env.MINI_CODER_AUTOPEN === '1';
  if (openOnStartup) {
    autoOpenTimer = setTimeout(() => {
      autoOpenTimer = undefined;
      info('[autopen] 启动后自动打开 Chat 面板');
      void vscode.commands.executeCommand('mini-coder.openChat');
    }, 4000);
  }

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
  //   ⭐ 用 getEffective() 而不是 getApiKey()：
  //     SecretStorage 里没 key，但 .env 里有 key（工作区根）的情况很常见。
  //     之前只看 SecretStorage，插件会在用户【已经配好了】的情况下
  //     还弹"需要先配置 API Key" —— 又一个"配置项骗用户"。
  const eff = await configManager.getEffective();
  if (!eff.key) {
    const action = await vscode.window.showInformationMessage(
      eff.foreignSecret
        ? `欢迎使用 Mini-Coder！你换成了 ${eff.provider}，但加密存储里那把 key 是 ${
            eff.secretProvider ?? '别的 provider'
          } 的。点「立即设置」为 ${eff.provider} 换一把。`
        : '欢迎使用 Mini-Coder！需要先配置 LLM API Key（BYOK 模式，零内置费用）',
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
  // ⭐ 清掉"启动后自动打开面板"的定时器（2026-10-30 加）
  //   不清的话，扩展在 4 秒内被卸载，这个回调照样会跑 ——
  //   扩展已经 deactivate 了，它还在弹面板 / 往失效的 API 发消息。
  if (autoOpenTimer) {
    clearTimeout(autoOpenTimer);
    autoOpenTimer = undefined;
  }
  // 清掉本次会话的写操作授权记录，避免下次启动还残留
  resetApprovals();
  ChatPanel.currentPanel?.dispose();
  // ⭐ MCP 服务器的子进程要杀掉 —— 否则会留下孤儿 node 进程
  void getMcpManager()?.stopAll();
  setMcpManager(null);
}

/**
 * ⭐ 启动体检：把"真正会生效的那一套配置"打进日志 + 真打一次接口
 *
 *   排在 activate 早期调用，这样用户遇到问题时的第一份日志就能回答
 *   "到底哪一环坏了"，而不是让用户自己去猜。
 *
 *   ⚠️ 这里会发一个 max_tokens=1 的真实请求（几分钱以内）。
 *      它换来的是：用户第一次打开就知道"key 有效但账户没钱"，
 *      而不是聊到一半才炸。
 */
async function logStartupHealth(): Promise<void> {
  try {
    const eff = await configManager.getEffective();

    const providerFrom =
      eff.providerSource === 'settings'
        ? '设置界面'
        : eff.providerSource === 'env'
          ? '.env'
          : '上次向导选择';

    const keyFrom =
      eff.keySource === 'env'
        ? `.env（${eff.envPath ?? '项目根'}）`
        : eff.keySource === 'secret'
          ? 'SecretStorage'
          : '未就绪';

    info(
      `生效配置：provider=${eff.provider}（来自${providerFrom}） · model=${eff.model} · baseUrl=${eff.baseUrl}`,
    );
    info(
      eff.key
        ? `API Key：已就绪（长度 ${eff.key.length}，来源 ${keyFrom}）`
        : eff.foreignSecret
          ? `API Key：未就绪 —— SecretStorage 里那把属于 ${eff.secretProvider ?? '别的 provider'}，当前是 ${eff.provider}，没有拿来顶替`
          : 'API Key：未就绪',
    );

    // 真打一次接口（不是"检查 key 存不存在"，而是"这个 key 现在能不能用"）
    const probe = await probeApi(eff);
    info(`API 连通性：${probe.ok ? '✅' : '❌'} ${probe.detail.replace(/\n\s+/g, ' ')}`);
  } catch (e: any) {
    info(`启动体检失败：${e?.message || e}`);
  }
}