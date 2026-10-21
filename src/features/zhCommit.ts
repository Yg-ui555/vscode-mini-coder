/**
 * 特色 2：中文 commit 规范
 *
 * 为什么做这个：
 * - 国际惯例是 conventional commit（英文：feat:/fix:/docs:）
 * - 国内开发者写英文 commit 痛苦（措辞难、缩写多）
 * - 我们做中文 commit：功能: / 修复: / 文档: / 重构: / 测试: / 样式: / 杂项:
 *
 * 工作流：
 * 1. 用户在 Source Control 面板点 "生成中文 commit"
 * 2. git diff 拿改动
 * 3. LLM 看 diff → 生成中文 commit message
 * 4. 写到剪贴板 + 弹窗显示 + 自动填到 commit message 输入框
 */

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigManager } from '../config';
import { OpenAIProvider } from '../agent/provider';
import { getDefaultCwd } from '../agent/tools/paths';

const execAsync = promisify(exec);

export function registerZhCommit(context: vscode.ExtensionContext, configManager: ConfigManager) {
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.zhCommit', async () => {
      const configured = await configManager.ensureConfigured();
      if (!configured) return;

      // 拿 git diff（含未跟踪的新文件）
      const diff = await getGitDiff();
      if (!diff || diff.includes('no changes added')) {
        vscode.window.showInformationMessage('没有检测到改动');
        return;
      }

      // 调 LLM 生成中文 commit
      const message = await generateZhCommit(diff, configured);

      // 复制到剪贴板 + 弹窗
      await vscode.env.clipboard.writeText(message);

      // ⭐ 原来用 `executeCommand('type', {text})` 想把消息打进 SCM 输入框，
      //   这是不可靠的：type 命令只对【当前聚焦的编辑器】生效，
      //   而 workbench.scm.acceptInput 打开的 commit 输入框不一定会拿到焦点。
      //   改成 git commit 命令行方案：真能落地，且可控。
      const action = await vscode.window.showInformationMessage(
        `生成的中文 commit：\n\n${message}\n\n已复制到剪贴板`,
        '直接提交',
        '打开提交框',
        '取消',
      );

      if (action === '直接提交') {
        // 只提交【已暂存】的内容 —— git commit 本身就不会动未 add 的文件，
        // 所以这里不存在"误提交"的风险；没 add 时 git 会报 no changes added。
        await new Promise<void>((resolve) => {
          const child = exec('git commit -F -', { maxBuffer: 5 * 1024 * 1024 }, (err: any, stdout, stderr) => {
            if (err) {
              vscode.window.showErrorMessage(
                `提交失败：${(stderr || err.message || '').split('\n').slice(0, 3).join('\n')}\n\n` +
                `提示：请先在左侧源代码管理面板点 "+" 暂存文件（git commit 只提交已暂存的内容）。\n` +
                `message 已复制到剪贴板，可手动粘贴。`,
              );
            } else {
              vscode.window.showInformationMessage(`✓ 已提交\n${(stdout || '').split('\n').slice(0, 2).join('\n')}`);
            }
            resolve();
          });
          child.stdin?.end(message, 'utf-8');
        });
      } else if (action === '打开提交框') {
        // 粘贴板里已经有 message，用户自己 Ctrl+V，更可靠
        await vscode.commands.executeCommand('workbench.scm.acceptInput');
        vscode.window.showInformationMessage('请在输入框里按 Ctrl+V 粘贴（已复制到剪贴板）');
      }
    }),
  );
}

/**
 * 拿 git diff（未暂存 + 已暂存 + ⭐未跟踪的新文件）
 *
 * ⭐ 修复的关键 bug：
 *   原来只用 `git diff HEAD`，它【看不见未跟踪的新文件】。
 *   git diff 只比较"git 已记录的版本"和"硬盘上的版本"，
 *   新建文件在 git 里的状态是 ?? (untracked)，git 根本不知道它存在。
 *   实测：新建 newfile.py + 改 a.txt → git diff HEAD 只有 a.txt。
 *   后果：新建功能文件时生成的 commit message 会完全漏掉这个文件，
 *         这是"新建功能"这个最高频场景被精准打击。
 *
 * 做法：
 *   1. git diff HEAD —— 跟踪文件的改动
 *   2. git ls-files --others --exclude-standard —— 列出未跟踪文件
 *   3. 直接读这些文件内容拼成"新文件"段落喂给 LLM
 *      （不用 git diff --no-index，因为 Windows 上 /dev/null 不存在，容易踩坑）
 */
async function getGitDiff(): Promise<string> {
  let diff = '';
  // ⚠️ cwd 必须是工作区根：扩展宿主进程的 process.cwd() 不保证等于工作区
  try {
    const { stdout } = await execAsync('git diff HEAD', {
      maxBuffer: 5 * 1024 * 1024, // 5MB
      cwd: getDefaultCwd(),
    });
    diff = stdout.trim();
  } catch {
    // 非 git 仓库 / 没有 HEAD（首次提交前）→ 下面走 untracked 分支
  }

  const newFiles = await getUntrackedFiles();
  return diff + newFiles;
}

/** 收集未跟踪文件的内容，拼成 LLM 能读的文本 */
async function getUntrackedFiles(): Promise<string> {
  const repoRoot = getDefaultCwd();
  try {
    const { stdout } = await execAsync(
      'git ls-files --others --exclude-standard',
      { maxBuffer: 2 * 1024 * 1024, cwd: repoRoot },
    );
    const files = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    if (files.length === 0) return '';

    // 只取前 30 个文件、每个前 120 行，避免撑爆上下文
    const LIMIT_FILES = 30;
    const LIMIT_LINES = 120;
    const parts: string[] = [`\n\n=== 新增文件（git 尚未跟踪，git diff 看不到它们）===`];

    for (const rel of files.slice(0, LIMIT_FILES)) {
      try {
        // ⚠️ 用 repoRoot 解析相对路径，不是 process.cwd()
        const abs = path.resolve(repoRoot, rel);
        const content = await fs.readFile(abs, 'utf-8');
        const lines = content.split('\n');
        const shown = lines.slice(0, LIMIT_LINES);
        parts.push(
          `\n--- 新文件: ${rel}（共 ${lines.length} 行${lines.length > LIMIT_LINES ? `，仅显示前 ${LIMIT_LINES} 行` : ''}）---\n${shown.join('\n')}`,
        );
      } catch {
        // 二进制文件 / 读不了 → 跳过
        parts.push(`\n--- 新文件: ${rel}（无法读取，可能是二进制）---`);
      }
    }

    if (files.length > LIMIT_FILES) {
      parts.push(`\n[... 还有 ${files.length - LIMIT_FILES} 个新文件未列出 ...]`);
    }

    return parts.join('\n');
  } catch {
    return '';
  }
}

/**
 * 暴露给 slash command /commit：拿 diff + 调 LLM，返回中文 commit
 */
export async function generateZhCommitStandalone(
  configured: { key: string; config: { baseUrl: string; defaultModel: string } },
): Promise<string | null> {
  const diff = await getGitDiff();
  if (!diff || diff.includes('no changes added')) return null;
  return generateZhCommit(diff, configured);
}

/**
 * 调 LLM 生成中文 commit
 */
async function generateZhCommit(
  diff: string,
  configured: { key: string; config: { baseUrl: string; defaultModel: string } },
): Promise<string> {
  const provider = new OpenAIProvider(
    configured.config.baseUrl,
    configured.key,
    configured.config.defaultModel,
  );

  // 截断（防 token 爆炸）。
  // ⭐ 修复：原来是无脑 slice(0, 8000)，如果新增文件排在后面（现在正是追加在末尾），
  //   会被整个切掉，等于白改。用「头尾都留」的方式保证新文件信息不丢。
  const DIFF_BUDGET = 12000;
  let truncatedDiff: string;
  if (diff.length <= DIFF_BUDGET) {
    truncatedDiff = diff;
  } else {
    const headLen = Math.floor(DIFF_BUDGET * 0.6);
    truncatedDiff =
      diff.slice(0, headLen) +
      `\n\n[... 省略中间 ${diff.length - DIFF_BUDGET} 字符 ...]\n\n` +
      diff.slice(-(DIFF_BUDGET - headLen));
  }

  const messages = [
    {
      role: 'system',
      content:
        '你是 commit message 专家。给定 git diff，生成符合中文 conventional commit 规范的 message。\n\n' +
        '规范（必须用）：\n' +
        '- 功能: 新功能\n' +
        '- 修复: bug 修复\n' +
        '- 文档: 文档更新\n' +
        '- 重构: 代码重构\n' +
        '- 测试: 测试相关\n' +
        '- 样式: 格式化\n' +
        '- 杂项: 其他\n\n' +
        '格式：`<类型>: <简短描述（不超过 50 字）>`\n\n' +
        '示例：\n' +
        '- `功能: 加登录页支持 OAuth 登录`\n' +
        '- `修复: 修复 pytest 在 Windows 路径报错`\n' +
        '- `重构: 把 sync 函数改成 async`\n\n' +
        '只返回 commit message，不要其他内容。',
    },
    {
      role: 'user',
      content: `git diff:\n\n${truncatedDiff}\n\n请生成中文 commit message。`,
    },
  ];

  let result = '';
  try {
    for await (const chunk of provider.stream(messages, [], undefined)) {
      if (chunk.content) result += chunk.content;
    }
  } catch (e: any) {
    vscode.window.showErrorMessage(`生成失败: ${e.message}`);
    return '功能: 更新代码';
  }

  // 清理：去掉 markdown ``` ``` 包裹
  result = result.replace(/```/g, '').trim();

  // 第一行作为 commit message
  const firstLine = result.split('\n')[0].trim();
  return firstLine || '功能: 更新代码';
}