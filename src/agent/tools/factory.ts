/**
 * 工具注册工厂 —— 全项目唯一一份"Mini-Coder 有哪些工具"的定义
 *
 * ⭐ 为什么要抽这个模块（2026-10-21 加固时发现）：
 *   在此之前，工具注册散落在 4 个地方：
 *     1. src/webview/panel.ts      —— 聊天面板用
 *     2. src/eval/runner.ts        —— 评测沙箱用
 *     3. src/commands/doctor.ts    —— 自检用（还硬编码了一份 expected 名单）
 *     4. src/features/autoTest.ts  —— AI 修测试用（只注册了 2 个）
 *   后果是：加一个新工具要改 4 处，漏一处就出现"聊天里能用、评测里用不了"
 *   的诡异不一致 —— 而且评测结果会失真（评测环境的能力 ≠ 真实用户的能力，
 *   那评测集测出来的 pass rate 就没有意义了）。
 *
 *   现在改这一处，四处自动同步。
 */

import { ToolRegistry } from './registry';
import { ReadFileTool } from './readFile';
import { WriteFileTool } from './writeFile';
import { ApplyPatchTool } from './applyPatch';
import { RunShellTool } from './runShell';
import { GrepTool } from './grep';
import { GlobTool } from './glob';
import { ListDirTool } from './listDir';
import { RestoreFileTool } from './restoreFile';
import { ReadOnlyToolNames } from './meta';

/**
 * 完整工具集 —— 用户实际能用的全部工具
 *
 * 顺序很重要：先只读后写入。
 *   理由一：LLM 读 schema 是按顺序的，把最常用的只读工具排前面，
 *           它更可能选对工具（对应 nanobot 的 get_definitions 排序策略）。
 *   理由二：工具顺序稳定 → prompt 前缀稳定 → 能命中 provider 端的
 *           prompt cache，直接省钱。
 */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // 只读组：无副作用，自动放行，可并行
  registry.register(new ReadFileTool());
  registry.register(new GrepTool());
  registry.register(new GlobTool());
  registry.register(new ListDirTool());

  // 写入组：有副作用，需要确认 + checkpoint
  registry.register(new ApplyPatchTool());
  registry.register(new WriteFileTool());
  registry.register(new RestoreFileTool());

  // 执行组：能力最大，破坏性最高
  registry.register(new RunShellTool());

  return registry;
}

/**
 * 只读工具集 —— 用于"只想让它看，不想让它动"的场景
 *   /doctor 检查、只读诊断、未来可能的 plan 模式
 */
export function createReadOnlyRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new ReadFileTool());
  registry.register(new GrepTool());
  registry.register(new GlobTool());
  registry.register(new ListDirTool());
  return registry;
}

/**
 * AI 修测试用的工具集
 *
 * 刻意【不给】run_shell：修复循环里让 LLM 自己乱跑命令风险太高
 * （它可能为了"试试看"执行 rm 或装包）。要看代码用 read/grep 就够了。
 */
export function createFixRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new ReadFileTool());
  registry.register(new GrepTool());
  registry.register(new GlobTool());
  registry.register(new ListDirTool());
  registry.register(new ApplyPatchTool());
  return registry;
}

/** 全部工具名（/doctor 用来核对有没有漏注册） */
export const ALL_TOOL_NAMES = [
  ...ReadOnlyToolNames,
  'apply_patch',
  'write_file',
  'restore_file',
  'run_shell',
];
