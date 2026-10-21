/**
 * 会话管理命令 —— 恢复历史会话 / 列出历史会话
 *
 * 为什么要单独一个模块：
 *   ChatPanel 是单例 UI，会话数据却必须在"面板没打开"时也能操作
 *   （比如用户关掉了面板，想从命令面板恢复昨天的对话）。
 *   所以这里自己建一个 SessionStore —— 它们指向同一份磁盘文件，互不冲突。
 */

import * as vscode from 'vscode';
import { SessionStore, SessionMeta } from '../session/store';
import { info } from '../logger';

/** 按当前工作区建一个 store */
export function createStore(context: vscode.ExtensionContext): SessionStore {
  const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  return new SessionStore(context.storageUri?.fsPath ?? '', wsPath);
}

function formatWhen(meta: SessionMeta): string {
  const d = new Date(meta.updatedAt);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  return sameDay
    ? `今天 ${d.toTimeString().slice(0, 5)}`
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.toTimeString().slice(0, 5)}`;
}

/** 注册命令 */
export function registerSessionCommands(context: vscode.ExtensionContext): void {
  // 列出并恢复历史会话
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.restoreSession', async () => {
      const store = createStore(context);
      const list = store.list();

      if (list.length === 0) {
        vscode.window.showInformationMessage(
          '当前工作区还没有历史会话。打开聊天面板对话后会自动保存。',
        );
        return;
      }

      const picked = await vscode.window.showQuickPick(
        list.map((m) => ({
          label: m.title,
          description: `${formatWhen(m)} · ${m.messageCount} 条消息`,
          detail: m.model ? `模型：${m.model}` : undefined,
          sessionId: m.id,
        })),
        {
          placeHolder: '选择要恢复的历史会话',
        },
      );

      if (!picked) return;

      if (!store.switchTo(picked.sessionId)) {
        vscode.window.showErrorMessage('切换会话失败：会话文件可能已被删除');
        return;
      }

      const loaded = store.load(picked.sessionId);

      // ⭐ 关键：通知已打开的面板重新加载。
      //   面板自己也持有一个 SessionStore 实例，它的 currentSessionId
      //   是面板创建时读出来的 —— 不通知的话会出现"命令说切换成功了，
      //   但面板里还是旧对话"的诡异状态。
      await vscode.commands.executeCommand('mini-coder.openChat');
      await vscode.commands.executeCommand('mini-coder.reloadSession');

      vscode.window.showInformationMessage(
        `✓ 已切换到会话「${loaded.meta?.title ?? picked.sessionId}」（${loaded.messages.length} 条消息）`,
      );
    }),
  );

  // 列出历史会话（只看不切）
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.listSessions', async () => {
      const store = createStore(context);
      const list = store.list();

      if (list.length === 0) {
        vscode.window.showInformationMessage('当前工作区还没有历史会话。');
        return;
      }

      const text = list
        .slice(0, 30)
        .map(
          (m) =>
            `${formatWhen(m)}  ${m.title}\n` +
            `    ${m.messageCount} 条消息${m.model ? ` · ${m.model}` : ''}${m.id === store.currentSessionId ? '  ← 当前' : ''}`,
        )
        .join('\n');

      // 输出到日志面板，方便长列表阅读
      const lines = text.split('\n');
      lines.forEach((l: string) => info(l));
      vscode.window.showInformationMessage(
        `当前工作区共 ${list.length} 个历史会话（完整列表见「输出 → Mini-Coder」）`,
      );
    }),
  );
}
