/**
 * 特色 1：自动跑测试 + 自动修
 *
 * 为什么做这个：
 * - Cline/Continue 都是改完让用户自己跑测试
 * - 真实痛点：保存代码 → 提 PR → CI 跑测试才发现失败
 * - 我们做的事：保存 .py 文件 → 自动 pytest → 失败 → 一键 AI 修复
 *
 * 工作原理：
 * 1. VS Code FileSystemWatcher 监听文件保存事件
 * 2. 识别 .py / .ts / .js 文件
 * 3. 自动跑对应测试（pytest / vitest）
 * 4. 如果失败，弹窗让用户选择"AI 自动修"
 * 5. 调用 AgentLoop 让 LLM 看失败信息 → 改代码 → 再跑测试
 *
 * 这是真差异化：别人不做，因为觉得"改完用户自己跑"
 * 实际上：自动跑 + 自动修 = 省用户 5 分钟 × 每天 = 一年 30 小时
 */

import * as vscode from 'vscode';
import { ConfigManager } from '../config';
import { OpenAIProvider } from '../agent/provider';
import { AgentLoop } from '../agent/loop';
import { ToolRegistry } from '../agent/tools/registry';
import { ReadFileTool } from '../agent/tools/readFile';
import { ApplyPatchTool } from '../agent/tools/applyPatch';
import { RunShellTool } from '../agent/tools/runShell';

let watcher: vscode.FileSystemWatcher | undefined;

export function registerAutoTest(context: vscode.ExtensionContext, configManager: ConfigManager) {
  // 监听 Python / TypeScript / JavaScript 文件保存
  watcher = vscode.workspace.createFileSystemWatcher('**/*.{py,ts,js}');

  watcher.onDidChange(async (uri) => {
    await handleFileChange(uri, configManager);
  });

  context.subscriptions.push(watcher);

  // 手动触发命令
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.runTest', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('请先打开一个文件');
        return;
      }
      await runTestsAndMaybeFix(editor.document.uri.fsPath, configManager);
    }),
  );
}

/**
 * 暴露给 slash command /test：跑项目测试，返回结构化结果
 * 不触发 AI 修复（避免副作用）
 */
export async function runProjectTests(): Promise<{ passed: number; failed: number; total: number; output: string }> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  // 检测项目类型：python vs node
  const isPy = require('fs').existsSync(`${cwd}/pyproject.toml`) || require('fs').existsSync(`${cwd}/pytest.ini`) || require('fs').existsSync(`${cwd}/tests`);
  const cmd = isPy ? 'pytest -q --tb=line 2>&1 | head -50' : 'npm test --silent 2>&1 | head -50';

  const output = await runShellFromCwd(cmd, cwd);

  // 简易解析：pytest "X passed" / npm "Tests N"
  const pyMatch = output.match(/(\d+)\s+passed/i);
  const npmMatch = output.match(/Tests:\s*(\d+)\s+passed,\s*(\d+)\s+failed/i);
  const passed = pyMatch ? parseInt(pyMatch[1], 10) : (npmMatch ? parseInt(npmMatch[1], 10) : 0);
  const failed = npmMatch ? parseInt(npmMatch[2], 10) : (output.toLowerCase().includes('failed') ? 1 : 0);
  const total = passed + failed;

  return { passed, failed, total, output: output.slice(0, 2000) };
}

/**
 * 文件变化时触发：自动跑测试
 */
async function handleFileChange(uri: vscode.Uri, configManager: ConfigManager) {
  const filePath = uri.fsPath;
  const ext = filePath.split('.').pop();

  // 只处理测试相关变更（避免无意义触发）
  // 用户改非测试文件 → 不自动跑（避免噪音）
  // 用户改测试文件 → 自动跑
  if (!filePath.includes('test') && !filePath.includes('spec')) {
    return;
  }

  vscode.window.showInformationMessage(`📝 检测到测试文件变更: ${filePath.split(/[\\/]/).pop()}`);

  await runTestsAndMaybeFix(filePath, configManager);
}

/**
 * 跑测试 + 如果失败让 AI 修
 */
async function runTestsAndMaybeFix(filePath: string, configManager: ConfigManager) {
  const ext = filePath.split('.').pop();
  let testCommand = '';

  if (ext === 'py') {
    testCommand = `pytest ${filePath} -v --tb=short`;
  } else if (ext === 'ts' || ext === 'js') {
    testCommand = `npx vitest run ${filePath}`;
  } else {
    return;
  }

  // 先跑测试
  const output = await runShell(testCommand);
  if (output.includes('passed') || output.includes('ok')) {
    vscode.window.showInformationMessage('✓ 测试通过');
    return;
  }

  // 失败：问用户要不要 AI 修
  const action = await vscode.window.showWarningMessage(
    `测试失败。是否让 AI 自动修复？\n\n${output.slice(0, 200)}`,
    'AI 自动修',
    '查看详情',
    '取消',
  );

  if (action !== 'AI 自动修') return;

  await aiFixTestFailure(filePath, output, configManager);
}

/**
 * 包装 run_shell 工具来跑命令
 */
async function runShell(command: string): Promise<string> {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec(
      command,
      { maxBuffer: 10 * 1024 * 1024, shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash' },
      (err: any, stdout: string, stderr: string) => {
        resolve(`${stdout || ''}${stderr || ''}${err ? `\n[exit ${err.code}]` : ''}`);
      },
    );
  });
}

/** 在指定 cwd 跑命令（slash command /test 用） */
async function runShellFromCwd(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec(
      command,
      { maxBuffer: 10 * 1024 * 1024, shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash', cwd },
      (err: any, stdout: string, stderr: string) => {
        resolve(`${stdout || ''}${stderr || ''}${err ? `\n[exit ${err.code}]` : ''}`);
      },
    );
  });
}

/**
 * AI 自动修测试失败
 */
async function aiFixTestFailure(
  filePath: string,
  failureOutput: string,
  configManager: ConfigManager,
) {
  const configured = await configManager.ensureConfigured();
  if (!configured) return;

  const provider = new OpenAIProvider(
    configured.config.baseUrl,
    configured.key,
    configured.config.defaultModel,
  );

  const registry = new ToolRegistry();
  registry.register(new ReadFileTool());
  registry.register(new ApplyPatchTool());

  const loop = new AgentLoop(provider, registry, 10);

  const messages: any[] = [
    {
      role: 'system',
      content:
        '你是测试修复专家。看到测试失败信息后，分析失败原因，' +
        '用 apply_patch 工具修源代码，**不要修测试**（除非测试本身写错）。修完报告改了什么。',
    },
    {
      role: 'user',
      content: `测试失败信息：\n\n${failureOutput.slice(0, 5000)}\n\n请用 read_file + apply_patch 修复。`,
    },
  ];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'AI 正在修复测试失败...',
    },
    async () => {
      const result = await loop.run(messages, undefined, {
        onText: (chunk) => {
          // 输出 channel 显示 AI 的思考过程
          console.log('[AI]', chunk);
        },
        onToolCall: (name) => console.log('[Tool]', name),
        onToolResult: (name, r) =>
          console.log(`[Tool Result] ${name}: ${r.content.slice(0, 100)}`),
      });

      vscode.window.showInformationMessage(`AI 修复完成: ${result.slice(0, 200)}`);

      // 自动再跑一次测试验证
      const ext = filePath.split('.').pop();
      const testCommand =
        ext === 'py'
          ? `pytest ${filePath} -v --tb=short`
          : `npx vitest run ${filePath}`;
      const retestOutput = await runShell(testCommand);
      if (retestOutput.includes('passed')) {
        vscode.window.showInformationMessage('✓ 测试通过！');
      } else {
        vscode.window.showWarningMessage(`⚠ 仍然失败: ${retestOutput.slice(0, 200)}`);
      }
    },
  );
}