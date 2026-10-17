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
import { ConfigManager } from '../config';
import { OpenAIProvider } from '../agent/provider';

const execAsync = promisify(exec);

export function registerZhCommit(context: vscode.ExtensionContext, configManager: ConfigManager) {
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.zhCommit', async () => {
      const configured = await configManager.ensureConfigured();
      if (!configured) return;

      // 拿 git diff
      const diff = await getGitDiff();
      if (!diff || diff.includes('no changes added')) {
        vscode.window.showInformationMessage('没有检测到改动');
        return;
      }

      // 调 LLM 生成中文 commit
      const message = await generateZhCommit(diff, configured);

      // 复制到剪贴板 + 弹窗
      await vscode.env.clipboard.writeText(message);
      const action = await vscode.window.showInformationMessage(
        `生成的中文 commit：\n\n${message}\n\n已复制到剪贴板`,
        '填入 commit 输入框',
        '取消',
      );

      if (action === '填入 commit 输入框') {
        // 触发 commit 输入框，把 message 填进去
        vscode.commands.executeCommand('workbench.scm.acceptInput');
        // 然后通过 typing 把 message 填进 input
        await vscode.commands.executeCommand('type', { text: message });
      }
    }),
  );
}

/**
 * 拿 git diff（未暂存 + 已暂存）
 */
async function getGitDiff(): Promise<string> {
  try {
    const { stdout } = await execAsync('git diff HEAD', {
      maxBuffer: 5 * 1024 * 1024, // 5MB
    });
    return stdout.trim();
  } catch (e: any) {
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

  // 截断 diff（防 token 爆炸）
  const truncatedDiff = diff.slice(0, 8000);

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