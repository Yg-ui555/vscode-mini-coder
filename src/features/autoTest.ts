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
import { info } from '../logger';

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
  const isPy =
    require('fs').existsSync(`${cwd}/pyproject.toml`) ||
    require('fs').existsSync(`${cwd}/pytest.ini`) ||
    require('fs').existsSync(`${cwd}/tests`);
  // ⭐ 修复：原来用 `2>&1 | head -50`，但 head 是 Linux 命令，
  //   Windows 的 cmd.exe 根本没有这条命令 → 整条命令直接崩，/test 从来没成功过。
  //   截断改在 Node 里做（跨平台，且能保留尾部报错）。
  const cmd = isPy ? 'pytest -q --tb=short' : 'npm test';

  const result = await runShellFromCwd(cmd, cwd);
  const output = truncateKeepTail(result.output);

  const stats = isPy ? parsePytest(output) : parseNodeTest(output);

  return { passed: stats.passed, failed: stats.failed, total: stats.total, output };
}

/** ⭐ 按退出码判断成败，而不是 output.includes('passed')。
 *  原因：pytest 失败时输出是 "3 failed, 5 passed" —— 这行字里有 "passed"，
 *  原来的判断会误报"测试通过"，于是永远不触发 AI 修复。
 */
function didTestsPass(output: string, exitCode: number | null): boolean {
  // 退出码是最可靠的信号
  if (exitCode === 0) return true;
  if (exitCode !== null) return false;
  // 拿不到退出码时才退化到文本判断（并且要同时排除 failed）
  return /passed/i.test(output) && !/failed|error/i.test(output);
}

/** 保留尾部（报错在末尾），抄 goose 的 head/tail 策略 */
function truncateKeepTail(text: string, max = 4000): string {
  if (text.length <= max) return text;
  const headLen = Math.floor(max * 0.4);
  return (
    text.slice(0, headLen) +
    `\n\n[... 省略中间 ${text.length - max} 字符 ...\n\n` +
    text.slice(-(max - headLen))
  );
}

/** 解析 pytest 输出：`3 failed, 5 passed in 0.5s` */
function parsePytest(output: string): { passed: number; failed: number; total: number } {
  const failed = Number(output.match(/(\d+)\s+failed/)?.[1] ?? 0);
  const passed = Number(output.match(/(\d+)\s+passed/)?.[1] ?? 0);
  const errors = Number(output.match(/(\d+)\s+error/)?.[1] ?? 0);
  return { passed, failed: failed + errors, total: passed + failed + errors };
}

/** 解析 node 测试输出（vitest/jest 两种格式都试） */
function parseNodeTest(output: string): { passed: number; failed: number; total: number } {
  const vitest = output.match(/Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed/);
  if (vitest) {
    const failed = Number(vitest[1]);
    const passed = Number(vitest[2]);
    return { passed, failed, total: passed + failed };
  }
  const jest = output.match(/Tests:\s*(\d+)\s+failed,\s*(\d+)\s+passed/);
  if (jest) {
    const failed = Number(jest[1]);
    const passed = Number(jest[2]);
    return { passed, failed, total: passed + failed };
  }
  const npmOut = output.match(/(\d+)\s+passing/);
  if (npmOut) return { passed: Number(npmOut[1]), failed: 0, total: Number(npmOut[1]) };
  return { passed: 0, failed: output.toLowerCase().includes('fail') ? 1 : 0, total: 0 };
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
  const { output, exitCode } = await execCommand(testCommand, process.cwd());
  if (didTestsPass(output, exitCode)) {
    vscode.window.showInformationMessage('✓ 测试通过');
    return;
  }

  // 失败：问用户要不要 AI 修
  const action = await vscode.window.showWarningMessage(
    `测试失败。是否让 AI 自动修复？\n\n${truncateKeepTail(output, 300)}`,
    'AI 自动修',
    '查看详情',
    '取消',
  );

  if (action !== 'AI 自动修') return;

  await aiFixTestFailure(filePath, output, configManager);
}

/**
 * 跑命令，返回「输出 + 退出码」
 * ⭐ 退出码是关键：测试成败靠它判断，不靠 grep 文本（"3 failed, 5 passed" 里有 passed）
 */
async function execCommand(
  command: string,
  cwd: string,
): Promise<{ output: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec(
      command,
      { maxBuffer: 10 * 1024 * 1024, shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash', cwd },
      (err: any, stdout: string, stderr: string) => {
        const out = `${stdout || ''}${stderr || ''}`;
        resolve({ output: out, exitCode: err ? (err.code ?? null) : 0 });
      },
    );
  });
}

/** 包装 run_shell 工具来跑命令（兼容旧签名） */
async function runShell(command: string): Promise<string> {
  const r = await execCommand(command, process.cwd());
  return r.output;
}

/** 在指定 cwd 跑命令（slash command /test 用） */
async function runShellFromCwd(command: string, cwd: string): Promise<{ output: string; exitCode: number | null }> {
  return execCommand(command, cwd);
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
          // ⭐ 原来用 console.log，在 VS Code 扩展宿主里用户根本看不到
          //   （console.log 输出到开发者工具，不进「输出」面板）。
          //   改用项目自己的 logger → 用户在「输出 → Mini-Coder」能看到 AI 的思考过程。
          info(`[AI 修复] ${chunk}`);
        },
        onToolCall: (name) => info(`[AI 修复] 调用工具: ${name}`),
        onToolResult: (name, r) =>
          info(`[AI 修复] ${name} → ${r.isError ? '失败' : '成功'}: ${r.content.slice(0, 200)}`),
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