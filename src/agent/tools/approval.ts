/**
 * 写操作确认 —— 用户对"AI 要改我代码"的知情权
 *
 * 为什么需要：
 * 现在的流程是 LLM 说改就改，用户完全不知情。
 * LLM 判断错误很常见（把测试文件当垃圾文件、把配置写错），
 * 而"静默覆盖用户文件"是 AI 编程助手最被诟病的问题。
 *
 * 对标：
 *   goose: 5 种权限决策（AlwaysAllow / AllowOnce / Cancel / DenyOnce / AlwaysDeny），
 *         按 (工具名, 参数哈希) 记忆授权
 *   nanobot: 反复越界会升级提示
 *   我们做最小可用版：写操作前问一次，支持"本次会话都允许"
 *
 * 类比：以前 agent 是拿着钥匙直接进屋，现在进屋前会敲一下门。
 *
 * 注意：读操作（read_file）和 run_shell 不走这里 ——
 *      read_file 不产生副作用；run_shell 的风险用"危险命令检测"处理，
 *      不在这里混在一起，避免每次跑 ls 都要点确认。
 */

interface VscodeLike {
  window: {
    showWarningMessage: (
      message: string,
      ...items: string[]
    ) => Thenable<string | undefined>;
  };
}

/** 本次会话已授权的工具（key = 工具名） */
const sessionApprovals = new Set<string>();

/** 首次运行还没问过的工具（只问一次，之后记到 sessionApprovals） */
const askedTools = new Set<string>();

function safeVscode(): VscodeLike | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('vscode');
  } catch {
    return undefined; // 测试环境 / 非 VS Code 宿主
  }
}

/**
 * 审批模式
 *  - 'ask'：正常模式，弹窗问用户（VS Code 里的默认行为）
 *  - 'auto'：自动放行（单测用——否则 stub 的 showWarningMessage
 *             一律返回 undefined，所有写操作都会被拒，测试全挂）
 */
let approvalMode: 'ask' | 'auto' = 'ask';

export function setApprovalMode(mode: 'ask' | 'auto'): void {
  approvalMode = mode;
}

/** 新会话开始时调用，清空授权记录 */
export function resetApprovals(): void {
  sessionApprovals.clear();
  askedTools.clear();
}

/** 供测试用：查询当前授权状态 */
export function isApproved(toolName: string): boolean {
  return sessionApprovals.has(toolName);
}

/**
 * 写操作执行前请求授权
 *
 * @param toolName 工具名（用于记忆授权）
 * @param summary  给用户看的改动摘要（一句话说清要改什么）
 * @returns true = 允许，false = 拒绝（拒绝时工具应返回错误让 LLM 知道）
 */
export async function requireWriteApproval(
  toolName: string,
  summary: string,
): Promise<boolean> {
  if (sessionApprovals.has(toolName)) return true;
  if (approvalMode === 'auto') return true;

  const vscode = safeVscode();
  // 测试环境没有 vscode → 放行，避免测试全部卡住
  if (!vscode) return true;

  const isFirstAsk = !askedTools.has(toolName);

  const action = await vscode.window.showWarningMessage(
    `Mini-Coder 准备修改你的文件\n\n${summary}`,
    ...(isFirstAsk ? ['允许一次', '本次会话都允许', '拒绝'] : ['允许一次', '拒绝']),
  );

  if (action === '本次会话都允许') {
    sessionApprovals.add(toolName);
    return true;
  }

  if (action === '允许一次') return true;

  // 取消 / 拒绝
  askedTools.add(toolName);
  return false;
}

/**
 * 危险 shell 命令检测（只读提示，不阻断）
 *
 * run_shell 能执行任意命令，这是能力最大的工具。
 * 完全靠路径白名单管不住它 —— 命令可以是 rm -rf。
 * 这里做的是"高危命令提示"，比 goose 的做法轻，
 * 但至少让用户在按下回车前看到一眼。
 *
 * 做成"提示"而不是"阻断"，是为了避免误伤：
 * 比如 "git commit --amend" 匹配不到危险词，
 * 但 "rm -rf /" 必须提示。
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+\//i, reason: '递归删除根目录' },
  { pattern: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i, reason: '递归强制删除' },
  { pattern: /\bdel\s+\/[sq]/i, reason: 'Windows 递归删除' },
  { pattern: /\bRemove-Item\b.*-Recurse.*-Force/i, reason: 'PowerShell 递归强制删除' },
  { pattern: /\bformat\s+[a-z]:/i, reason: '格式化磁盘' },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: 'fork 炸弹' },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b/i, reason: '关机/重启' },
  { pattern: /\bgit\s+push\s+.*--force(?!-with-lease)/i, reason: '强制推送（会覆盖远端历史）' },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: '硬重置（丢弃本地改动）' },
  { pattern: /\bchmod\s+-R\s+777\s+\//i, reason: '全局权限放开' },
];

/** 返回命中的危险原因，没命中返回 undefined */
export function detectDangerousCommand(command: string): string | undefined {
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return reason;
  }
  return undefined;
}

/**
 * shell 命令执行前的风险提示
 * @returns true = 放行
 */
export async function confirmShellCommand(
  command: string,
): Promise<{ approved: boolean; reason?: string }> {
  const reason = detectDangerousCommand(command);
  if (!reason) return { approved: true };
  if (approvalMode === 'auto') return { approved: true };

  const vscode = safeVscode();
  if (!vscode) return { approved: true };

  const action = await vscode.window.showWarningMessage(
    `⚠ 这条命令包含高危操作：${reason}\n\n${command}`,
    '仍然执行',
    '取消',
    { modal: true } as any,
  );

  return { approved: action === '仍然执行', reason };
}