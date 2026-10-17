/**
 * 特色 3：错题本自动归档
 *
 * 为什么做这个：
 * - 改完代码就忘了为什么改、改了什么、踩了什么坑
 * - 别人没做因为要做"个人记忆"层，技术上要持久化
 * - 我们做的事：每次修改 → 自动写到 .notes/今天.md
 *
 * 工作流：
 * 1. 用户每次保存 .py / .ts / .js 文件
 * 2. 看 git diff 或文件修改历史
 * 3. 自动追加到 `.notes/今天.md`
 * 4. 文件按日期归档，方便回顾
 *
 * 错题本格式：
 * # 2025-10-15 学习记录
 *
 * ## 14:30 - main.py
 * - 修改：把同步函数改成 async
 * - 关键 diff：
 *   - sync_func(x) -> await async_func(x)
 * - 测试结果：pytest 通过
 * - 踩坑：Python 3.10 之前 await 不能用
 *
 * 这是真差异化：
 * - 别人：改完不记录
 * - 你：每次改动都自动归档
 * - 学习价值：一年后回看，知道自己踩过什么坑
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

let watcher: vscode.FileSystemWatcher | undefined;

export function registerNotes(context: vscode.ExtensionContext) {
  // 监听所有代码文件保存
  watcher = vscode.workspace.createFileSystemWatcher('**/*.{py,ts,js,tsx,jsx,go,rs,java}');

  watcher.onDidChange(async (uri) => {
    await appendToNotes(uri, '文件变更');
  });

  context.subscriptions.push(watcher);

  // 手动命令：查看今日错题本
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.viewNotes', async () => {
      const today = getTodayFileName();
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showInformationMessage('请先打开一个文件夹');
        return;
      }

      const notesPath = path.join(workspaceFolder.uri.fsPath, '.notes', today);

      try {
        const doc = await vscode.workspace.openTextDocument(notesPath);
        await vscode.window.showTextDocument(doc);
      } catch {
        vscode.window.showInformationMessage(`今日错题本不存在: ${notesPath}`);
      }
    }),
  );
}

/**
 * 追加改动到今天的错题本
 */
async function appendToNotes(uri: vscode.Uri, action: string) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const today = getTodayFileName();
  const notesDir = path.join(workspaceRoot, '.notes');
  const notesPath = path.join(notesDir, today);

  const filePath = uri.fsPath;
  const fileName = path.basename(filePath);
  const now = new Date().toTimeString().slice(0, 5); // HH:MM

  const entry =
    `\n## ${now} - ${fileName}\n` +
    `- 操作: ${action}\n` +
    `- 路径: \`${path.relative(workspaceRoot, filePath)}\`\n` +
    `- 时间戳: ${new Date().toISOString()}\n`;

  // 自动创建 .notes 目录
  await fs.mkdir(notesDir, { recursive: true });

  // 检查文件是否存在，不存在则建 header
  let existing = '';
  try {
    existing = await fs.readFile(notesPath, 'utf-8');
  } catch {
    existing = `# ${today.slice(0, 10)} 学习记录\n\n> 自动生成的代码改动记录。每次保存代码文件时，会自动追加到这里。\n`;
  }

  const updated = existing + entry;

  try {
    await fs.writeFile(notesPath, updated, 'utf-8');
  } catch (e: any) {
    console.error('写入错题本失败:', e.message);
  }
}

/**
 * 今天的文件名（2025-10-15.md）
 */
function getTodayFileName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}.md`;
}

/**
 * 暴露给 slash command /notes：读今天的错题本内容
 */
export async function readTodayNotes(): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return '';
  const notesPath = path.join(workspaceFolder.uri.fsPath, '.notes', getTodayFileName());
  try {
    return await fs.readFile(notesPath, 'utf-8');
  } catch {
    return '';
  }
}