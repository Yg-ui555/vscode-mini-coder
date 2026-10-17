/**
 * ChatPanel：VS Code Webview 聊天面板
 *
 * 什么是 Webview：在 VS Code 里嵌入一个 HTML+JS 页面，可以做自定义 UI
 * 跟 Extension 通信用 postMessage（双向消息）
 *
 * 这个面板跟 3 个特色（autoTest / zhCommit / notes）是独立的功能入口
 * 用户可以在 Webview 里给 agent 下自然语言指令，agent 自己调工具完成任务
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from '../config';
import { OpenAIProvider } from '../agent/provider';
import { AgentLoop } from '../agent/loop';
import { ToolRegistry } from '../agent/tools/registry';
import { ReadFileTool } from '../agent/tools/readFile';
import { WriteFileTool } from '../agent/tools/writeFile';
import { ApplyPatchTool } from '../agent/tools/applyPatch';
import { RunShellTool } from '../agent/tools/runShell';
import { ContextBuilder } from '../agent/context';
import { runSlashCommand, listSlashCommands } from '../slashCommands/registry';

export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _configManager: ConfigManager;
  private _disposed = false;
  // 多轮对话历史（system + 历史 messages）
  private _messages: any[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    configManager: ConfigManager,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._configManager = configManager;

    this._panel.webview.html = this._getHtml();

    // 接收 Webview 消息
    this._panel.webview.onDidReceiveMessage((msg) => this._handleMessage(msg));

    // 面板关闭时清理
    this._panel.onDidDispose(() => this._dispose(), null, []);
  }

  /**
   * 创建或显示面板（单例模式——只允许一个聊天窗口）
   */
  public static createOrShow(extensionUri: vscode.Uri, configManager: ConfigManager) {
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel._panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'miniCoderChat', // 内部 ID
      'Mini-Coder Chat', // 显示标题
      vscode.ViewColumn.Beside, // 出现在右侧
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // 限制 Webview 能加载的资源路径（安全）
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist-webview')],
      },
    );

    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri, configManager);
  }

  /**
   * 主动发消息给 Webview
   */
  private _postMessage(message: any) {
    if (!this._disposed) {
      this._panel.webview.postMessage(message);
    }
  }

  /**
   * 处理 Webview 来的消息
   */
  private async _handleMessage(msg: any) {
    switch (msg.type) {
      case 'ready':
        // Webview 准备就绪，告诉它当前状态 + slash command 列表
        this._postMessage({ type: 'status', content: 'ready' });
        this._postMessage({ type: 'slash_commands', commands: listSlashCommands() });
        break;
      case 'user_input':
        await this._runAgent(msg.content);
        break;
      case 'slash_command':
        await this._handleSlashCommand(msg.content);
        break;
    }
  }

  /**
   * 处理 slash command（/test /commit /notes /solve）
   *
   * 借鉴自 goose-main/crates/goose/src/slash_commands/
   * 我们走简化路线：内建 4 个 workflow 命令，不支持用户自定义
   */
  private async _handleSlashCommand(rawInput: string) {
    const result = await runSlashCommand(
      {
        configManager: this._configManager,
        postMessage: (m) => this._postMessage(m),
      },
      rawInput,
    );

    if (!result) {
      this._postMessage({ type: 'error', content: '无法解析 slash command' });
      return;
    }

    // 把结果作为 assistant 消息显示给用户
    this._postMessage({ type: 'text', content: result.message });
    this._postMessage({ type: 'final' });
  }

  /**
   * 跑 agent 主循环（这是 Webview 跟 LLM 通信的核心）
   */
  private async _runAgent(userInput: string) {
    // 1. 加载 LLM 配置
    const configured = await this._configManager.ensureConfigured();
    if (!configured) {
      this._postMessage({ type: 'error', content: '未配置 API Key，请先点"设置 API Key"' });
      return;
    }

    // 2. 初始化 agent 组件
    const provider = new OpenAIProvider(
      configured.config.baseUrl,
      configured.key,
      configured.config.defaultModel,
    );

    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new WriteFileTool());
    registry.register(new ApplyPatchTool());
    registry.register(new RunShellTool());

    const loop = new AgentLoop(provider, registry, 20);

    // 3. 拼 messages
    if (this._messages.length === 0) {
      // 取当前 VS Code 工作区根目录，让 ContextBuilder 自动加载 AGENTS.md
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
      const systemPrompt = new ContextBuilder(workspaceRoot).buildSystemPrompt();
      this._messages.push({ role: 'system', content: systemPrompt });
    }
    this._messages.push({ role: 'user', content: userInput });

    // 4. 跑主循环
    try {
      await loop.run(this._messages, undefined, {
        onText: (chunk) => this._postMessage({ type: 'text', content: chunk }),
        onToolCall: (name, args) => this._postMessage({ type: 'tool_call', name, args }),
        onToolResult: (name, result) =>
          this._postMessage({
            type: 'tool_result',
            name,
            result: result.content.slice(0, 1000),
            isError: !!result.isError,
          }),
      });
      this._postMessage({ type: 'final' });
    } catch (e: any) {
      this._postMessage({ type: 'error', content: `错误: ${e.message}` });
    }
  }

  /**
   * 读取 dist-webview/index.html，注入到 Webview
   * 如果没构建过（首次），提示用户构建
   */
  private _getHtml(): string {
    const htmlPath = path.join(this._extensionUri.fsPath, 'dist-webview', 'index.html');

    if (!fs.existsSync(htmlPath)) {
      return `<!DOCTYPE html>
<html><body style="padding:24px;font-family:sans-serif;color:#ccc;background:#1e1e1e">
  <h2 style="color:#f87171">⚠ Webview 未构建</h2>
  <p>第一次跑需要先构建 Webview UI：</p>
<pre style="background:#2d2d2d;padding:12px;border-radius:4px">
cd webview-ui
npm install
npm run build
</pre>
  <p>构建完后再按 F5 重新启动扩展。</p>
</body></html>`;
    }

    let html = fs.readFileSync(htmlPath, 'utf-8');

    // 把相对路径的 CSS/JS 资源转成 webview 可访问的 URI（file://）
    const webview = this._panel.webview;
    html = html.replace(/(href|src)="\.\/(.*?)"/g, (_match, attr, file) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist-webview', file));
      return `${attr}="${uri}"`;
    });

    return html;
  }

  private _dispose() {
    this._disposed = true;
    ChatPanel.currentPanel = undefined;
  }

  public dispose() {
    this._panel.dispose();
  }
}