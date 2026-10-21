/**
 * Vitest 全局 setup —— 在每个测试文件加载前执行
 *
 * 为什么需要这个文件：
 * 2026-10-20 给工具层加了「路径白名单」和「写操作确认」之后，
 * 原有测试大面积失败，原因有两个：
 *
 *   1) 原有测试都用 os.tmpdir() 下的【绝对路径】造临时文件，
 *      而 vscode-stub 里 workspaceFolders 是 undefined
 *      → 白名单认为"没有工作区" → 拒绝一切绝对路径
 *
 *   2) vscode-stub 的 showWarningMessage 一律返回 undefined
 *      → 写操作确认的返回值是 false → 所有写文件测试全挂
 *
 * 所以这里做两件事（仅测试环境生效，不影响真实使用）：
 *   - 把工作区根目录设成 os.tmpdir()，让临时文件路径合法
 *   - 把审批模式设成 'auto'，跳过弹窗确认
 *
 * ⚠️ 越界拦截的测试（regression/criticalBugs.test.ts）自己会在
 *    beforeEach 里 setWorkspaceRoot(自己的临时目录)，
 *    所以它测的仍然是真实白名单逻辑。
 */

import * as os from 'os';
import { setWorkspaceRoot } from '../agent/tools/paths';
import { setNonInteractive, resetApprovals } from '../agent/tools/approval';

// 测试用工作区根 = 系统临时目录
setWorkspaceRoot(os.tmpdir());

// 测试环境跳过写操作确认弹窗
setNonInteractive(true);

// 每个测试之间清空"本次会话已授权"记录，避免互相污染
resetApprovals();