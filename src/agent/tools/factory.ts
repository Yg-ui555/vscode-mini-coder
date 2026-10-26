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
import { Tool } from './base';
import { ReadFileTool } from './readFile';
import { WriteFileTool } from './writeFile';
import { ApplyPatchTool } from './applyPatch';
import { RunShellTool } from './runShell';
import { GrepTool } from './grep';
import { GlobTool } from './glob';
import { ListDirTool } from './listDir';
import { RestoreFileTool } from './restoreFile';
import { RecordNoteTool } from './recordNote';
import { TodoWriteTool } from './todoWrite';
import { DelegateTool } from './delegate';
import { ReadOnlyToolNames } from './meta';
import { createReadOnlyRegistry, SUBAGENT_READONLY_TOOLS } from './readonlySet';

export { createReadOnlyRegistry, SUBAGENT_READONLY_TOOLS };

/**
 * 完整工具集 —— 用户实际能用的全部工具
 *
 * 顺序很重要：先只读后写入。
 *   理由一：LLM 读 schema 是按顺序的，把最常用的只读工具排前面，
 *           它更可能选对工具（对应 nanobot 的 get_definitions 排序策略）。
 *   理由二：工具顺序稳定 → prompt 前缀稳定 → 能命中 provider 端的
 *           prompt cache，直接省钱。
 *
 * @param opts.exclude 消融：把指定工具【摘掉】
 * @param opts.include 白名单：只注册这些工具
 */
export function createDefaultRegistry(opts?: {
  exclude?: string[];
  include?: string[];
}): ToolRegistry {
  const registry = new ToolRegistry();

  // ⭐ 消融（ablation）：把指定工具【摘掉】，其余照常注册
  //
  //   为什么需要这个开关：
  //     pass rate 打到 100% 之后，"这题到底在测什么"就成了一个问题。
  //     光看"全过"什么都证明不了 —— 可能题目太简单，
  //     也可能 agent 恰好用了某个关键工具。
  //
  //   消融实验给出的答案更硬：
  //     把 grep 摘掉，如果某几题立刻挂 —— 说明这几题确实在测
  //     "会不会用搜索工具把影响面找全"，而不是送分题。
  //     这比"我全过了"有说服力得多。
  //
  //   ⚠️ 摘掉的工具不会出现在给 LLM 的 schema 里，
  //     所以 LLM 连"有这个工具"都不知道 —— 这才是干净的消融。
  //
  // ⚠️ 2026-10-25 补：光摘 schema 还不算干净！
  //   system prompt 原本【无条件】写着 record_note 的用法，
  //   所以消融 record_note 时 LLM 其实还是被教过这个工具 —— 那次消融是漏的。
  //   现在 ContextBuilder 接收实际注册的工具名，prompt 跟着一起裁剪
  //   （见 src/agent/context.ts 的 toolNames 参数）。
  //   其余工具 prompt 里本来就没提名字，一直是干净的。
  const exclude = new Set(opts?.exclude ?? []);
  // ⭐ 白名单模式：只注册名单里的工具（子智能体用）
  const include = opts?.include ? new Set<string>(opts.include) : null;

  const register = (tool: Tool) => {
    if (exclude.has(tool.name)) return;
    if (include && !include.has(tool.name)) return;
    registry.register(tool);
  };

  // 只读组：无副作用，自动放行，可并行
  register(new ReadFileTool());
  register(new GrepTool());
  register(new GlobTool());
  register(new ListDirTool());
  register(new RecordNoteTool());

  // 状态组：改的是 agent 自己的状态，不动用户的文件
  //   todo_write —— 多步任务的进度真相
  //   delegate   —— 派子智能体去做独立调查（上下文隔离）
  register(new TodoWriteTool());
  register(new DelegateTool());

  // 写入组：有副作用，需要确认 + checkpoint
  register(new ApplyPatchTool());
  register(new WriteFileTool());
  register(new RestoreFileTool());

  // 执行组：能力最大，破坏性最高
  register(new RunShellTool());

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
  'record_note',
  'todo_write',
  'delegate',
  'apply_patch',
  'write_file',
  'restore_file',
  'run_shell',
];
