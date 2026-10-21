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
import { createDefaultRegistry } from '../agent/tools/factory';
import { ContextBuilder } from '../agent/context';
import { runSlashCommand, listSlashCommands } from '../slashCommands/registry';
import { toUserView } from '../errors';
import { info, warn, error as logError } from '../logger';
import { SessionStore } from '../session/store';
import { setCheckpointSession } from '../agent/checkpoint/store';
import { formatUsage } from '../util/tokens';

export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _extensionContext: vscode.ExtensionContext;
  private readonly _configManager: ConfigManager;
  private _disposed = false;
  // 多轮对话历史（system + 历史 messages）
  private _messages: any[] = [];
  // ⭐ 中断控制器：前端点"停止" → abort() → provider 的 fetch 和 shell 子进程都会被取消
  private _abortController: AbortController | undefined;
  // ⭐ 会话持久化：对话落盘，关掉 VS Code 再打开还在
  private readonly _sessionStore: SessionStore;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    extensionContext: vscode.ExtensionContext,
    configManager: ConfigManager,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._extensionContext = extensionContext;
    this._configManager = configManager;

    // 会话按工作区隔离存储（借鉴 nanobot 的三层 workspace 分离）
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    this._sessionStore = new SessionStore(extensionContext.storageUri?.fsPath ?? '', wsPath);

    // checkpoint 跟着会话走 —— 这样 VS Code 重开后 /undo 仍然有效
    setCheckpointSession(this._sessionStore.currentSessionId);

    // 恢复上次会话（如果有内容）
    const loaded = this._sessionStore.load();
    if (loaded.messages.length > 0) {
      this._messages = loaded.messages;
      info(
        `已恢复上次会话 ${loaded.meta?.id}：${loaded.messages.length} 条消息` +
          `（${loaded.meta?.updatedAt ? new Date(loaded.meta.updatedAt).toLocaleString('zh-CN') : '未知时间'}）`,
      );
    }

    this._panel.webview.html = this._getHtml();

    // 接收 Webview 消息
    this._panel.webview.onDidReceiveMessage((msg) => this._handleMessage(msg));

    // 面板关闭时清理
    this._panel.onDidDispose(() => this._dispose(), null, []);
  }

  /**
   * 创建或显示面板（单例模式——只允许一个聊天窗口）
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    extensionContext: vscode.ExtensionContext,
    configManager: ConfigManager,
  ) {
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

    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri, extensionContext, configManager);
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
        // ⭐ 把已恢复的历史灌给前端
        //   不发这一条的话，会话虽然在磁盘上，但用户打开面板看到的是空白，
        //   等于白存。前端对应的 case 在 ChatPanel.tsx 里。
        this._postMessage({ type: 'history', messages: this._messagesToWebview() });
        break;
      case 'user_input':
        await this._runAgent(msg.content);
        break;
      case 'slash_command':
        await this._handleSlashCommand(msg.content);
        break;
      case 'stop':
        // ⭐ 用户点了"停止"
        if (this._abortController) {
          this._abortController.abort();
          info('用户中断了当前任务');
        }
        break;
      case 'new_session':
        // 开一个新会话：内存清空 + 落盘指针切换 + checkpoint 换新会话目录
        this._messages = [];
        this._abortController?.abort();
        this._sessionStore.startNew();
        setCheckpointSession(this._sessionStore.currentSessionId);
        this._postMessage({ type: 'clear' });
        info(`用户开启了新会话：${this._sessionStore.currentSessionId}`);
        break;
      case 'run_command':
        // Webview 点 toast 修复按钮触发（如 "去设置"）
        await vscode.commands.executeCommand(msg.command);
        info(`通过 Webview 触发了命令：${msg.command}`);
        break;
    }
  }

  /**
   * 处理 slash command（/test /commit /notes /solve /doctor /logs）
   *
   * 借鉴自 goose-main/crates/goose/src/slash_commands/
   * 我们走简化路线：内建 4 个 workflow 命令，不支持用户自定义
   */
  private async _handleSlashCommand(rawInput: string) {
    const result = await runSlashCommand(
      {
        configManager: this._configManager,
        postMessage: (m) => this._postMessage(m),
        extensionPath: this._extensionUri.fsPath,
        extensionContext: this._extensionContext,
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
    info(`用户输入：${userInput.slice(0, 100)}${userInput.length > 100 ? '...' : ''}`);

    // 1. 加载 LLM 配置
    const configured = await this._configManager.ensureConfigured();
    if (!configured) {
      // 弹 toast + 错误信息（前端 ChatPanel 会显示按钮）
      this._postMessage({
        type: 'toast',
        level: 'error',
        content: '⚠ 未配置 API Key，请先设置',
        action: { label: '点我去设置', command: 'mini-coder.setApiKey' },
      });
      this._postMessage({ type: 'error', content: '未配置 API Key' });
      return;
    }

    // 2. 初始化 agent 组件
    const provider = new OpenAIProvider(
      configured.config.baseUrl,
      configured.key,
      configured.config.defaultModel,
    );
    info(`Provider：${configured.config.baseUrl} / ${configured.config.defaultModel}`);

    // 工具集由工厂统一提供（与评测沙箱、AI 修测试共用同一份定义）
    const registry = createDefaultRegistry();
    info(`已加载 ${registry.names.length} 个工具：${registry.names.join(', ')}`);

    const loop = new AgentLoop(provider, registry, 20, configured.config.defaultModel);

    // 3. 拼 messages
    if (this._messages.length === 0) {
      // 取当前 VS Code 工作区根目录，让 ContextBuilder 自动加载 AGENTS.md
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
      const systemPrompt = new ContextBuilder(workspaceRoot).buildSystemPrompt();
      this._messages.push({ role: 'system', content: systemPrompt });
    }
    this._messages.push({ role: 'user', content: userInput });

    // ⭐ 先把"用户问了什么"落盘，再去调 LLM
    //   这样即使中途崩了 / 被中断，重开后还能看到用户提过什么需求，
    //   不会变成"什么都没发生过"。
    await this._persistSession(configured);

    // 4. 跑主循环（带中断能力）
    this._abortController = new AbortController();
    try {
      await loop.run(this._messages, this._abortController.signal, {
        onText: (chunk) => this._postMessage({ type: 'text', content: chunk }),
        onToolCall: (name, args) => this._postMessage({ type: 'tool_call', name, args }),
        onToolResult: (name, result) =>
          this._postMessage({
            type: 'tool_result',
            name,
            result: result.content.slice(0, 1000),
            isError: !!result.isError,
          }),
        // ⭐ 上下文用量实时回传，让用户看得见"还剩多少"
        onCompact: (msg) => this._postMessage({ type: 'text', content: `\n${msg}\n` }),
        onUsage: (used, window) =>
          this._postMessage({ type: 'usage', content: formatUsage(used, window) }),
      });
      this._postMessage({ type: 'final' });
      info('agent.run 完成');
    } catch (e: any) {
      // 用 toUserView 把错误转成"友好提示 + 修复按钮"
      const view = toUserView(e);
      logError(`agent.run 失败：${e?.message || e}`, e);

      // 发 toast（醒目小弹窗 + 快捷修复按钮）
      this._postMessage({
        type: 'toast',
        level: 'error',
        content: view.message,
        action: view.action,  // 可能 undefined
      });
      // 同时在聊天里显示
      this._postMessage({ type: 'error', content: view.message });
    } finally {
      this._abortController = undefined;
      // ⭐ 无论成功、失败还是被中断，都把当前对话存下来
      //   中断的场景尤其重要 —— 用户点"停止"然后关掉面板是高频操作。
      await this._persistSession(configured);
    }
  }

  /**
   * 从磁盘重新加载当前会话并刷新前端
   *
   * 用于「命令面板切换了会话 → 面板内容跟着变」这个场景。
   * 面板自己持有的 _sessionStore 是创建时读的 currentSessionId，
   * 命令面板改了磁盘上的 index.json 之后必须主动重载，
   * 否则会出现"提示切换成功但面板还是旧对话"。
   */
  public reloadFromDisk(): void {
    const store = new SessionStore(
      this._extensionContext.storageUri?.fsPath ?? '',
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
    );
    const loaded = store.load();
    this._messages = loaded.messages;
    setCheckpointSession(store.currentSessionId);
    this._postMessage({ type: 'history', messages: this._messagesToWebview() });
    info(`已重新加载会话 ${store.currentSessionId}：${loaded.messages.length} 条消息`);
  }

  /** 把当前 messages 落盘（失败只记日志，不打断使用） */
  private async _persistSession(configured?: { config: { defaultModel: string } }): Promise<void> {
    try {
      const provider = await this._configManager.getProvider();
      const meta = this._sessionStore.save(this._messages, {
        provider,
        model: configured?.config.defaultModel,
      });
      info(`会话已保存 ${meta.id}：${meta.messageCount} 条消息`);
    } catch (e: any) {
      warn(`会话保存失败：${e?.message || e}`);
    }
  }

  /**
   * 把内部 messages 转成前端能直接渲染的形状
   *
   * 内部结构里 assistant 消息带 tool_calls、tool 消息带 tool_call_id，
   * 但前端只需要"角色 + 文本 + 有哪些工具被调用过"，所以这里做一次降维。
   * 这样恢复历史时不会把一堆原始 JSON 塞给前端。
   */
  private _messagesToWebview(): Array<{
    role: string;
    content: string;
    tools?: Array<{ name: string; result?: string; isError?: boolean }>;
  }> {
    const out: any[] = [];

    for (const m of this._messages) {
      // system prompt 不给用户看
      if (m.role === 'system') continue;

      const text =
        typeof m.content === 'string'
          ? m.content
          : m.content
            ? JSON.stringify(m.content)
            : '';

      if (m.role === 'tool') {
        // 工具结果挂到上一条 assistant 消息的 tools 上
        const last = out[out.length - 1];
        const name = m.name || 'tool';
        if (last && last.tools && last.tools.length > 0) {
          const t = last.tools[last.tools.length - 1];
          if (!t.result) {
            t.result = text.slice(0, 500);
          }
        } else {
          out.push({ role: 'assistant', content: '', tools: [{ name, result: text.slice(0, 500) }] });
        }
        continue;
      }

      const tools = (m.tool_calls || []).map((tc: any) => ({
        name: tc?.function?.name || tc?.name || 'tool',
      }));

      if (!text && tools.length === 0) continue;

      if (text && out.length > 0 && out[out.length - 1].role === 'assistant' && tools.length > 0) {
        // assistant 既说了话又要调工具：合并
        out[out.length - 1] = { ...out[out.length - 1], tools };
      } else {
        out.push({ role: m.role, content: text, ...(tools.length > 0 ? { tools } : {}) });
      }
    }

    return out;
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
    const webview = this._panel.webview;

    // 关键修复 1：手动注入 CSP meta，放宽 script-src 让 module script 能加载
    // VS Code 1.86+ 默认 CSP 太严，module script 会被静默拒绝 → 黑屏
    const cspSource = webview.cspSource;
    const metaCsp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource} 'self' 'unsafe-inline' 'unsafe-eval'; style-src ${cspSource} 'self' 'unsafe-inline'; img-src ${cspSource} 'self' data: https:; font-src ${cspSource} 'self' data:;">`;
    html = html.replace(/<head>/i, `<head>\n    ${metaCsp}`);

    // 关键修复 2：去掉 crossorigin 属性（VS Code webview 不发 CORS headers，带 crossorigin 会加载失败）
    html = html.replace(/\s+crossorigin(?=[\s>])/g, '');

    // 把相对路径的 CSS/JS 资源转成 webview 可访问的 URI（file://）
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