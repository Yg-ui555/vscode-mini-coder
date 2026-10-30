/**
 * 特色 3：错题本自动归档 —— VS Code 侧接线层
 *
 * ⚠️ 2026-10-21 重写：之前的实现和宣传严重不符
 *
 * PROJECT.md 写的是「文件名 / 改动类型 / 关键 diff / 测试结果」，
 * 但旧实现只写了三行：时间、文件名、路径。没有任何原因、没有踩坑 ——
 * 而"踩了什么坑"恰恰是错题本的全部价值所在。
 *
 * ─────────────────────────────────────────────────────────────
 * 本文件只负责「什么时候触发」和「给用户看什么」，
 * 【怎么写文件】全在 util/notesStore.ts 里（纯 Node，不依赖 vscode）。
 *
 * 这个分离是必须的：record_note 工具也要写错题本，
 * 如果它 import 本文件，就会连带把 vscode 拉进来，
 * 导致评测 CLI / 单测等 VS Code 之外的环境直接崩。
 * ─────────────────────────────────────────────────────────────
 *
 * 两条来源，内容不重复：
 *   A)【agent 主动记录】record_note 工具
 *      agent 知道自己为什么这么改、踩了什么坑、测试过没有 → 富条目
 *   B)【watcher 被动记录】文件保存事件
 *      用户手动改代码时 agent 不知道 → 轻条目，同文件 5 分钟内只记一次
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { toWorkspaceRelative } from '../agent/tools/paths';
import {
  appendNoteEntry,
  readTodayNote,
  listNoteDays,
  getNotesDir,
} from '../util/notesStore';
import { info } from '../logger';

let watcher: vscode.FileSystemWatcher | undefined;

/** 同一文件在这个时间窗内只被动记一次（毫秒），避免连续保存刷屏 */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

const lastPassiveRecord = new Map<string, number>();

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// ─────────────────────── 注册 ───────────────────────

export function registerNotes(context: vscode.ExtensionContext) {
  watcher = vscode.workspace.createFileSystemWatcher(
    '**/*.{py,ts,tsx,js,jsx,go,rs,java,c,cpp,h}',
  );

  watcher.onDidChange(async (uri: vscode.Uri) => {
    const now = Date.now();
    const last = lastPassiveRecord.get(uri.fsPath) ?? 0;
    if (now - last < DEDUPE_WINDOW_MS) return; // 连续保存不重复记
    lastPassiveRecord.set(uri.fsPath, now);

    const root = workspaceRoot();
    if (!root) return;

    await appendNoteEntry(root, {
      kind: 'watch',
      time: new Date().toTimeString().slice(0, 5),
      title: `手动修改：${path.basename(uri.fsPath)}`,
      files: [{ path: toWorkspaceRelative(uri.fsPath), change: '手动修改' }],
    });
  });

  context.subscriptions.push(watcher);

  // 打开今天的错题本
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.viewNotes', async () => {
      const root = workspaceRoot();
      if (!root) {
        vscode.window.showInformationMessage('请先在 VS Code 里打开一个项目文件夹');
        return;
      }

      try {
        const doc = await vscode.workspace.openTextDocument(
          path.join(getNotesDir(root), (await listNoteDays(root))[0] ?? ''),
        );
        await vscode.window.showTextDocument(doc);
      } catch {
        vscode.window.showInformationMessage(
          '今天还没有错题记录。\n' +
            '让 Mini-Coder 改完代码后会自动记录它学到了什么，也可以手动执行 /undo 试一下。',
        );
      }
    }),
  );

  // 列出所有归档
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.listNotes', async () => {
      const root = workspaceRoot();
      if (!root) {
        vscode.window.showInformationMessage('请先打开一个项目文件夹');
        return;
      }

      const days = await listNoteDays(root);
      if (days.length === 0) {
        vscode.window.showInformationMessage('还没有任何错题记录');
        return;
      }

      info(`错题本归档（${days.length} 天）：\n${days.map((d) => `  .notes/${d}`).join('\n')}`);
      vscode.window.showInformationMessage(
        `共 ${days.length} 天的错题记录，列表见「输出 → Mini-Coder」`,
      );
    }),
  );
}

// ─────────────────────── 供 slash command 用 ───────────────────────

/** 读今天的错题本内容（/notes 用） */
export async function readTodayNotes(): Promise<string> {
  const root = workspaceRoot();
  if (!root) return '';
  return readTodayNote(root);
}