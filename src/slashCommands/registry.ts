/**
 * Slash Commands 注册中心
 *
 * 借鉴来源：D:/AI agent/goose-main/crates/goose/src/slash_commands/
 *   - slash_command.rs: SlashCommandEntry trait
 *   - recipe_slash_command.rs: recipe workflow 命令
 *   - skill_slash_command.rs: 用户自定义 skill 命令
 *
 * 我们的简化版：
 *   - 命令列表 = 内置 workflow 快捷方式（/test /commit /notes /solve）
 *   - 用户输 `/xxx` → 路由到对应 workflow
 *   - 不走 LLM，直接执行（更可预测、更快）
 *
 * 为什么有价值：
 *   - 高频操作一键触发（不用每次写"请帮我跑测试然后 commit"）
 *   - 用户留存更强（习惯后离不開）
 *   - vs Cline：没有 /solve 命令，没有 /notes 错题本命令
 */

import * as vscode from 'vscode';
import { ConfigManager } from '../config';
import { runProjectTests } from '../features/autoTest';
import { generateZhCommitStandalone } from '../features/zhCommit';
import { readTodayNotes } from '../features/notes';
import { runDoctor } from '../commands/doctor';

export interface SlashContext {
  configManager: ConfigManager;
  /** 触发命令时主动通知 Webview */
  postMessage: (msg: any) => void;
  /** 扩展根目录路径（用于 /doctor 检查文件） */
  extensionPath: string;
  /** VS Code ExtensionContext（用于 /doctor） */
  extensionContext: vscode.ExtensionContext;
}

export interface SlashResult {
  /** 反馈给用户的文字（Webview 显示） */
  message: string;
  /** 是否成功 */
  success: boolean;
}

/** 单个 slash command 定义 */
interface SlashCommand {
  name: string;
  description: string;
  argsHint?: string;
  handler: (ctx: SlashContext, args: string[]) => Promise<SlashResult>;
}

const COMMANDS: SlashCommand[] = [
  {
    name: 'test',
    description: '运行项目测试（pytest / npm test）',
    handler: async (ctx) => {
      postStatus(ctx, '🧪 正在跑测试...');
      const result = await runProjectTests();
      const msg = result.failed === 0
        ? `✅ 测试全部通过（${result.passed}/${result.total}）`
        : `❌ 测试失败 ${result.failed}/${result.total}\n\n${result.output}`;
      return { message: msg, success: result.failed === 0 };
    },
  },
  {
    name: 'commit',
    description: '生成中文 commit message（自动跑测试 + 看 git diff）',
    handler: async (ctx) => {
      postStatus(ctx, '📝 准备生成中文 commit...');
      const configured = await ctx.configManager.ensureConfigured();
      if (!configured) {
        return { message: '❌ 未配置 API Key，请先在命令面板设置', success: false };
      }
      const commit = await generateZhCommitStandalone(configured);
      if (!commit) {
        return { message: '⚠ 没有 git 改动或 LLM 未返回 commit', success: false };
      }
      return { message: `📝 中文 commit:\n\`\`\`\n${commit}\n\`\`\``, success: true };
    },
  },
  {
    name: 'notes',
    description: '查看今天的错题本 / 错题归档',
    handler: async () => {
      const notes = await readTodayNotes();
      if (!notes.trim()) {
        return { message: '📒 今天还没有错题记录', success: true };
      }
      return { message: `📒 今天的错题本：\n\`\`\`markdown\n${notes}\n\`\`\``, success: true };
    },
  },
  {
    name: 'solve',
    description: '解 LeetCode 题目（用法: /solve <题号或标题>）',
    argsHint: '<题号或标题>',
    handler: async (ctx, args) => {
      if (args.length === 0) {
        return { message: '用法: `/solve <题号或标题>`，例如 `/solve 1` 或 `/solve two sum`', success: false };
      }
      const query = args.join(' ');
      postStatus(ctx, `🧮 正在解 LeetCode: ${query}...`);
      // 把题目作为自然语言任务交给 agent 跑（agent 自主 fetch + 实现 + 测试）
      const taskPrompt = `请帮我做 LeetCode 题 "${query}"：
1. 先访问 https://leetcode.cn/problems/${encodeURIComponent(query.replace(/\s+/g, '-').toLowerCase())}/ 抓题目描述（如果访问失败用搜索）
2. 在当前工作区新建 solution.py（Python）或 solution.js（JS），写解题代码
3. 加 3 个单元测试覆盖核心边界
4. 跑测试确认通过
5. 把解题思路记到 .notes/今天.md

完成后报告：时间复杂度、空间复杂度、关键思路。`;
      ctx.postMessage({ type: 'user_input', content: taskPrompt });
      return { message: `🧮 已派发给 agent 跑 LeetCode: ${query}`, success: true };
    },
  },
  {
    name: 'doctor',
    description: '自检配置（API Key / Provider / Webview 构建 / 编译）',
    handler: async (ctx) => {
      const report = await runDoctor(ctx.extensionContext, ctx.configManager);
      return { message: report, success: true };
    },
  },
  {
    name: 'logs',
    description: '把当前日志复制到剪贴板（出问题时给开发者）',
    handler: async () => {
      await vscode.commands.executeCommand('mini-coder.copyLogs');
      return { message: '✓ 日志已复制到剪贴板', success: true };
    },
  },
];

function postStatus(ctx: SlashContext, status: string) {
  ctx.postMessage({ type: 'status', content: status });
}

/**
 * 解析 slash command 字符串
 * 例: "/commit" → {name: 'commit', args: []}
 * 例: "/solve 1 two-sum" → {name: 'solve', args: ['1', 'two-sum']}
 */
export function parseSlashCommand(input: string): { name: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  if (!name) return null;

  return { name, args };
}

/** 执行 slash command */
export async function runSlashCommand(
  ctx: SlashContext,
  rawInput: string,
): Promise<SlashResult | null> {
  const parsed = parseSlashCommand(rawInput);
  if (!parsed) return null;

  const cmd = COMMANDS.find((c) => c.name === parsed.name);
  if (!cmd) {
    return {
      message: `❌ 未知命令: \`/${parsed.name}\`\n可用命令: ${COMMANDS.map((c) => `\`/${c.name}\``).join('、')}`,
      success: false,
    };
  }

  return cmd.handler(ctx, parsed.args);
}

/** 给 Webview 展示的命令列表 */
export function listSlashCommands(): Array<{ name: string; description: string; argsHint?: string }> {
  return COMMANDS.map(({ name, description, argsHint }) => ({ name, description, argsHint }));
}
