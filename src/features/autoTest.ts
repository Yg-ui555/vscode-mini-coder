/**
 * 特色 1：自动跑测试 + 自动修
 *
 * 为什么做这个：
 * - Cline/Continue 都是改完让用户自己跑测试
 * - 真实痛点：保存代码 → 提 PR → CI 跑测试才发现失败
 * - 我们做的事：保存代码 → 自动找到相关测试 → 跑 → 失败 → 一键 AI 修复
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 2026-10-21 重写：修掉三个让这个特色【形同虚设】的 bug
 *
 * 1) 【触发条件反了】
 *    原来的判断是 `if (!filePath.includes('test')) return;`
 *    —— 只有【测试文件】变了才跑测试。
 *    但用户日常改的是【源代码】（src/xxx.py），改源代码什么都不发生。
 *    宣传语写的"保存代码自动跑测试"，实际是"保存测试才跑测试"。
 *
 * 2) 【includes('passed') 误判】
 *    AI 修完之后用 `retestOutput.includes('passed')` 判断是否修好。
 *    但 pytest 失败时的输出是 "3 failed, 5 passed" —— 这行字里有 "passed"。
 *    于是【测试明明还挂着，它却判定通过】，也就永远不会告诉用户失败。
 *    讽刺的是同一个文件 :82 就写着"不能用 includes 判断"的注释，
 *    到 :276 又犯了一次。
 *
 * 3) 【退出码被丢弃】
 *    runShell() 只返回字符串，把 exec 回调里的 exitCode 扔了，
 *    导致调用方根本没法用最可靠的信号。
 *
 * 现在：源码变更 → 找相关测试 → 跑 → 按退出码判定 → 失败才提示 AI 修复
 * ─────────────────────────────────────────────────────────────
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../config';
import { OpenAIProvider } from '../agent/provider';
import { AgentLoop } from '../agent/loop';
import { createFixRegistry } from '../agent/tools/factory';
import { getDefaultCwd, toWorkspaceRelative } from '../agent/tools/paths';
import { walkFiles, readTextSafe } from '../agent/tools/fileScan';
import { info, warn } from '../logger';

/** 触发防抖窗口：用户连续改多个文件时合并成一次测试 */
const DEBOUNCE_MS = 1500;

/** 命令执行超时 */
const CMD_TIMEOUT_MS = 120_000;

/** 找相关测试时最多扫多少个测试文件（防大仓库卡顿） */
const MAX_TEST_FILES_SCANNED = 300;

let watchers: vscode.FileSystemWatcher[] = [];

/** 防抖定时器 */
let debounceTimer: NodeJS.Timeout | undefined;

/** 防抖期间累积的变更文件 */
const pendingChanges = new Set<string>();

/** 本次会话是否正在自动修复（防止修的过程中又触发一轮） */
let isFixing = false;

export function registerAutoTest(context: vscode.ExtensionContext, configManager: ConfigManager) {
  // 监听源码 + 测试文件（原来的 '**/*.{py,ts,js}' 只在后面被 test 判断拦掉，等于白监听）
  const pattern = '**/*.{py,ts,tsx,js,jsx,mjs,cjs}';
  watchers = [
    vscode.workspace.createFileSystemWatcher(pattern),
    // 新建文件也要触发（原来只监听 onDidChange，新建文件不跑）
    vscode.workspace.createFileSystemWatcher('**/*.{py,ts,tsx,js,jsx,mjs,cjs}'),
  ];

  const onChange = (uri: vscode.Uri) => {
    const p = uri.fsPath;
    if (!shouldWatch(p)) return;
    scheduleTest(p, configManager);
  };

  watchers[0].onDidChange(onChange);
  watchers[1].onDidCreate(onChange);

  context.subscriptions.push(...watchers);

  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.runTest', async () => {
      const editor = vscode.window.activeTextEditor;
      const filePath = editor?.document.uri.fsPath;

      // 手动命令：跑全项目测试（不管有没有打开文件）
      vscode.window.showInformationMessage('🧪 正在跑项目测试...');
      const r = await runProjectTests();
      if (r.failed === 0) {
        vscode.window.showInformationMessage(`✓ 测试全部通过（${r.passed}/${r.total}）`);
      } else {
        const action = await vscode.window.showWarningMessage(
          `测试失败 ${r.failed}/${r.total}\n\n${truncateKeepTail(r.output, 400)}`,
          'AI 自动修',
          '查看输出',
          '取消',
        );
        if (action === 'AI 自动修') {
          await aiFixTestFailure(r.output, r.testCommand, configManager);
        } else if (action === '查看输出') {
          info(r.output);
          vscode.window.showInformationMessage('完整输出已送到「输出 → Mini-Coder」');
        }
      }
      void filePath;
    }),
  );
}

// ─────────────────────── 文件分类 ───────────────────────

/** 明确不该监听的路径 */
const IGNORE_PATTERNS = [
  /[\\/]node_modules[\\/]/,
  /[\\/]\.git[\\/]/,
  /[\\/]dist[\\/]/,
  /[\\/]out[\\/]/,
  /[\\/]build[\\/]/,
  /[\\/]dist-webview[\\/]/,
  /[\\/]coverage[\\/]/,
  /[\\/]__pycache__[\\/]/,
  /[\\/]\.venv[\\/]/,
  /[\\/]\.mini-coder[\\/]/,
  /[\\/]\.notes[\\/]/,
  /\.d\.ts$/,
  /\.min\.(js|css)$/,
  /\.lock$/,
  /package-lock\.json$/,
];

function shouldWatch(filePath: string): boolean {
  if (IGNORE_PATTERNS.some((re) => re.test(filePath))) return false;
  return true;
}

/**
 * 判断是不是「测试文件」
 *
 * 覆盖常见约定：
 *   tests/ test/ __tests__/ spec/ 目录
 *   xxx.test.ts / xxx.spec.ts
 *   test_xxx.py（pytest 默认）
 *   xxx_test.py
 */
export function isTestFile(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  if (/[\\/](tests?|__tests__|spec)[\\/]/i.test(p)) return true;
  if (/\.(test|spec)\.[jt]sx?$/i.test(p)) return true;
  if (/(^|\/)test_[^/]+\.py$/i.test(p)) return true;
  if (/_test\.py$/i.test(p)) return true;
  return false;
}

// ─────────────────────── 相关测试查找 ───────────────────────

/**
 * 找出和某个源文件相关的测试文件
 *
 * 策略（保守，宁可少跑也不要跑错）：
 *   1. 先收集仓库里所有测试文件（一次遍历）
 *   2. 对每个测试文件，看它是否提到了源文件的模块名
 *      （比如 src/utils/helper.js → 找包含 "helper" 的测试文件）
 *   3. 都没提到 → 返回空数组，不自动跑
 *
 * 为什么保守：跑错测试比不跑测试更烦人 —— 用户会以为"绿色=没问题"，
 * 而实际上根本没测到他刚改的东西。
 */
export function findRelatedTests(sourcePath: string, root: string): string[] {
  const base = path.basename(sourcePath).replace(/\.[^.]+$/, '');
  if (!base || base.length < 2) return [];

  const { files, truncated } = walkFiles({ root, timeBudgetMs: 3000 });

  const testFiles = files
    .filter((f) => isTestFile(f.abs))
    .slice(0, MAX_TEST_FILES_SCANNED);

  if (testFiles.length === 0) return [];

  const related: string[] = [];

  for (const tf of testFiles) {
    const content = readTextSafe(tf.abs);
    if (content === null) continue;

    // 三种关联信号，任一命中就算相关：
    //   1. 出现了源文件模块名（import/require/字符串引用）
    //   2. 出现了源文件的完整相对路径
    //   3. 测试文件在同一目录（同目录通常就是配套测试）
    const mentionsName = new RegExp(`\\b${escapeRegex(base)}\\b`).test(content);
    const mentionsPath = content.includes(toWorkspaceRelative(sourcePath).replace(/\\/g, '/'));
    const sameDir = path.dirname(tf.abs).toLowerCase() === path.dirname(sourcePath).toLowerCase();

    if (mentionsName || mentionsPath || sameDir) {
      related.push(tf.abs);
    }
  }

  if (truncated) {
    warn(`找相关测试时扫描不完整（${testFiles.length} 个测试文件），可能漏掉部分`);
  }

  return related;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────── 防抖调度 ───────────────────────

function scheduleTest(filePath: string, configManager: ConfigManager): void {
  const mode = getAutoTestMode();

  if (mode === 'off') return;

  // AI 正在修的时候别再触发，否则改一下文件就跑一轮，修到一半被打断
  if (isFixing) {
    info('[autoTest] AI 修复进行中，忽略本次文件变更');
    return;
  }

  pendingChanges.add(filePath);

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const batch = [...pendingChanges];
    pendingChanges.clear();
    debounceTimer = undefined;
    void runForChanges(batch, configManager, mode);
  }, DEBOUNCE_MS);
}

/** 读设置：off | related | all */
function getAutoTestMode(): 'off' | 'related' | 'all' {
  try {
    return vscode.workspace.getConfiguration('mini-coder').get<'off' | 'related' | 'all'>('autoTestMode') ?? 'related';
  } catch {
    return 'related';
  }
}

/** 处理一批文件变更（防抖后调用） */
async function runForChanges(
  changed: string[],
  configManager: ConfigManager,
  mode: 'related' | 'all',
): Promise<void> {
  if (changed.length === 0) return;

  const root = getDefaultCwd();

  // 情况 1：有测试文件直接变了 → 跑这些测试文件
  const changedTests = changed.filter(isTestFile);
  if (changedTests.length > 0) {
    const names = changedTests.map((p) => path.basename(p)).join(', ');
    info(`[autoTest] 测试文件变更：${names}`);
    for (const t of changedTests) {
      await runAndMaybeFix(buildTestCommand(t, root), `测试文件 ${path.basename(t)} 变更`, configManager);
    }
    return;
  }

  // 情况 2：只改了源码
  const sources = changed.filter((p) => !isTestFile(p));
  if (sources.length === 0) return;

  if (mode === 'all') {
    info(`[autoTest] 源码变更（模式=all），跑全项目测试`);
    const r = await runProjectTests();
    if (r.failed > 0) {
      void promptAiFix(r.output, r.testCommand, `源码变更后全量测试失败`, configManager);
    }
    return;
  }

  // mode === 'related'：找相关测试
  for (const src of sources) {
    const related = findRelatedTests(src, root);
    if (related.length === 0) {
      info(`[autoTest] ${path.basename(src)} 没有找到相关测试，跳过`);
      continue;
    }
    info(`[autoTest] ${path.basename(src)} → ${related.length} 个相关测试`);
    for (const t of related) {
      await runAndMaybeFix(buildTestCommand(t, root), `${path.basename(src)} 变更`, configManager);
    }
  }
}

// ─────────────────────── 跑测试 ───────────────────────

/** 项目类型：python 还是 node */
export function detectProjectType(root: string): 'py' | 'node' {
  if (
    fs.existsSync(path.join(root, 'pyproject.toml')) ||
    fs.existsSync(path.join(root, 'pytest.ini')) ||
    fs.existsSync(path.join(root, 'setup.py')) ||
    fs.existsSync(path.join(root, 'requirements.txt'))
  ) {
    return 'py';
  }
  return 'node';
}

/**
 * 为一个测试文件生成运行命令
 *
 * ⚠️ 必须用【相对路径】且转成正斜杠：
 *   Windows 绝对路径是 C:\a\b，交给 pytest 没问题，
 *   但交给 vitest 当过滤条件时反斜杠匹配不上，等于什么都没测。
 */
export function buildTestCommand(testFile: string, root: string): string {
  const rel = path.relative(root, testFile).split(path.sep).join('/');
  const type = detectProjectType(root);
  if (type === 'py' || testFile.endsWith('.py')) {
    return `python -m pytest "${rel}" -q --tb=short`;
  }
  return `npx vitest run "${rel}"`;
}

/** 项目全量测试命令 */
export function buildProjectTestCommand(root: string): string {
  return detectProjectType(root) === 'py' ? 'python -m pytest -q --tb=short' : 'npm test';
}

/** 跑一条命令，返回输出 + 退出码 */
async function execCommand(
  command: string,
  cwd: string,
): Promise<{ output: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec(
      command,
      {
        maxBuffer: 10 * 1024 * 1024,
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
        cwd,
        timeout: CMD_TIMEOUT_MS,
      },
      (err: any, stdout: string, stderr: string) => {
        const out = `${stdout || ''}${stderr || ''}`;
        // err.code 在超时/被杀时可能是字符串（如 'ETIMEDOUT'），
        // 那时归一成 null，让上层走文本判断
        const raw = err ? err.code : 0;
        const exitCode = typeof raw === 'number' ? raw : err ? null : 0;
        resolve({ output: out, exitCode });
      },
    );
  });
}

/**
 * ⭐ 按【退出码】判断成败，绝不用 includes('passed')
 *
 * 原因（这是本文件被修过一次的 bug）：pytest 失败时的输出是
 * "3 failed, 5 passed" —— 这一行里就有 "passed"。
 * 用字符串匹配会导致"测试明明挂了却判定通过"。
 */
export function didTestsPass(output: string, exitCode: number | null): boolean {
  if (exitCode === 0) return true;
  if (exitCode !== null) return false;
  // 只有拿不到退出码（进程被杀/超时）才退化到文本判断，且必须同时排除 failed/error
  return /passed/i.test(output) && !/failed|error/i.test(output);
}

/** 保留尾部（报错在末尾），抄 goose 的 head/tail 策略 */
export function truncateKeepTail(text: string, max = 4000): string {
  if (text.length <= max) return text;
  const headLen = Math.floor(max * 0.4);
  return (
    text.slice(0, headLen) +
    `\n\n[... 省略中间 ${text.length - max} 字符 ...\n\n` +
    text.slice(-(max - headLen))
  );
}

/** 解析 pytest 输出：`3 failed, 5 passed in 0.5s` */
export function parsePytest(output: string): { passed: number; failed: number; total: number } {
  const failed = Number(output.match(/(\d+)\s+failed/)?.[1] ?? 0);
  const passed = Number(output.match(/(\d+)\s+passed/)?.[1] ?? 0);
  const errors = Number(output.match(/(\d+)\s+error/)?.[1] ?? 0);
  return { passed, failed: failed + errors, total: passed + failed + errors };
}

/** 解析 node 测试输出（vitest / jest 两种格式都试） */
export function parseNodeTest(output: string): { passed: number; failed: number; total: number } {
  const vitest = output.match(/Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed/);
  if (vitest) {
    return { passed: Number(vitest[2]), failed: Number(vitest[1]), total: Number(vitest[1]) + Number(vitest[2]) };
  }
  const jest = output.match(/Tests:\s*(\d+)\s+failed,\s*(\d+)\s+passed/);
  if (jest) {
    return { passed: Number(jest[2]), failed: Number(jest[1]), total: Number(jest[1]) + Number(jest[2]) };
  }
  const mocha = output.match(/(\d+)\s+passing/);
  if (mocha) return { passed: Number(mocha[1]), failed: 0, total: Number(mocha[1]) };
  return { passed: 0, failed: output.toLowerCase().includes('fail') ? 1 : 0, total: 0 };
}

export interface ProjectTestResult {
  passed: number;
  failed: number;
  total: number;
  output: string;
  testCommand: string;
}

/** 跑全项目测试（slash command /test 用） */
export async function runProjectTests(): Promise<ProjectTestResult> {
  const cwd = getDefaultCwd();
  const testCommand = buildProjectTestCommand(cwd);

  const result = await execCommand(testCommand, cwd);
  const output = truncateKeepTail(result.output);
  const stats = detectProjectType(cwd) === 'py' ? parsePytest(output) : parseNodeTest(output);

  // ⭐ 用退出码兜底：如果文本解析出 failed=0 但退出码非 0，说明有解析不了的失败
  const passed = result.exitCode === 0 && stats.failed === 0 ? Math.max(stats.passed, 1) : stats.passed;
  const failed = result.exitCode === 0 ? stats.failed : Math.max(stats.failed, 1);

  return { passed, failed, total: Math.max(stats.total, passed + failed), output, testCommand };
}

/** 跑一条测试命令 + 失败时问用户要不要 AI 修 */
async function runAndMaybeFix(
  testCommand: string,
  reason: string,
  configManager: ConfigManager,
): Promise<void> {
  const cwd = getDefaultCwd();
  info(`[autoTest] ${reason} → ${testCommand}`);

  const { output, exitCode } = await execCommand(testCommand, cwd);
  const ok = didTestsPass(output, exitCode);

  if (ok) {
    vscode.window.setStatusBarMessage('$(check) 测试通过', 3000);
    info(`[autoTest] ✓ ${testCommand} 通过`);
    return;
  }

  await promptAiFix(output, testCommand, reason, configManager);
}

/** 测试失败 → 问用户要不要 AI 修 */
async function promptAiFix(
  output: string,
  testCommand: string,
  reason: string,
  configManager: ConfigManager,
): Promise<void> {
  const action = await vscode.window.showWarningMessage(
    `${reason}，测试失败。是否让 AI 自动修复？\n\n${truncateKeepTail(output, 300)}`,
    'AI 自动修',
    '查看详情',
    '取消',
  );

  if (action === '查看详情') {
    info(output);
    vscode.window.showInformationMessage('完整输出已送到「输出 → Mini-Coder」');
    return;
  }
  if (action !== 'AI 自动修') return;

  await aiFixTestFailure(output, testCommand, configManager);
}

// ─────────────────────── AI 自动修 ───────────────────────

/**
 * AI 自动修测试失败
 *
 * ⚠️ 防死循环：最多修 FIX_MAX_ROUNDS 轮，每轮修完重跑测试，
 *    还失败就停下来问用户要不要继续，而不是无限循环烧钱。
 */
const FIX_MAX_ROUNDS = 3;

async function aiFixTestFailure(
  failureOutput: string,
  testCommand: string,
  configManager: ConfigManager,
): Promise<void> {
  const configured = await configManager.ensureConfigured();
  if (!configured) return;

  const provider = new OpenAIProvider(
    configured.config.baseUrl,
    configured.key,
    configured.config.defaultModel,
  );

  // 修复循环刻意不给 run_shell：不让 LLM 为了"试试看"乱跑命令
  const registry = createFixRegistry();

  isFixing = true;
  try {
    for (let round = 1; round <= FIX_MAX_ROUNDS; round++) {
      const loop = new AgentLoop(provider, registry, 10, configured.config.defaultModel);

      const messages: any[] = [
        {
          role: 'system',
          content:
            `你是测试修复专家。职责：\n` +
            `1. 先用 grep / read_file 定位失败的真实原因\n` +
            `2. 用 apply_patch 修【源代码】\n` +
            `3. 除非能证明是测试本身写错（并明确说明理由），否则不要修改测试文件\n` +
            `4. 改完用一句话说明改了什么、为什么\n\n` +
            `你没有 run_shell 工具，不能自己跑命令 —— 改完我会替你验证。`,
        },
        {
          role: 'user',
          content:
            `第 ${round}/${FIX_MAX_ROUNDS} 轮修复。\n\n` +
            `测试命令：${testCommand}\n\n` +
            `失败输出：\n${failureOutput.slice(0, 5000)}\n\n` +
            `请用 grep / read_file 定位问题，用 apply_patch 修复。`,
        },
      ];

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `AI 正在修复测试失败（第 ${round}/${FIX_MAX_ROUNDS} 轮）...`,
          cancellable: false,
        },
        async () => {
          await loop.run(messages, undefined, {
            onText: (chunk) => info(`[AI 修复] ${chunk}`),
            onToolCall: (name) => info(`[AI 修复] 调用工具: ${name}`),
            onToolResult: (name, r) =>
              info(`[AI 修复] ${name} → ${r.isError ? '失败' : '成功'}: ${r.content.slice(0, 200)}`),
          });
        },
      );

      // ⭐ 用退出码重新验证（原来这里用的是 includes('passed')，永远判通过）
      const cwd = getDefaultCwd();
      const { output: retestOutput, exitCode: retestCode } = await execCommand(testCommand, cwd);

      if (didTestsPass(retestOutput, retestCode)) {
        vscode.window.setStatusBarMessage('$(check) AI 修复成功，测试通过', 5000);
        vscode.window.showInformationMessage('✓ AI 修复完成，测试已通过');
        return;
      }

      failureOutput = retestOutput; // 把新一轮失败输出喂回去

      if (round < FIX_MAX_ROUNDS) {
        vscode.window.showWarningMessage(
          `第 ${round} 轮修复后测试仍失败，正在重试…\n${truncateKeepTail(retestOutput, 200)}`,
        );
      }
    }

    vscode.window.showWarningMessage(
      `⚠ 修 ${FIX_MAX_ROUNDS} 轮后测试仍未通过，已停止（避免无限循环烧 token）。\n` +
        `完整输出见「输出 → Mini-Coder」。可以让我用 /undo 退回刚才的修改。`,
    );
    info(`[AI 修复] 修 ${FIX_MAX_ROUNDS} 轮仍未通过：\n${failureOutput.slice(0, 2000)}`);
  } finally {
    isFixing = false;
  }
}