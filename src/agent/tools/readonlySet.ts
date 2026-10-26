/**
 * 只读工具集 —— 单独一个模块，切断循环依赖
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么这个文件存在
 *
 *   factory.ts 要 import delegate.ts（注册 delegate 工具），
 *   而 delegate.ts 又需要"只读工具集"来造子 agent 的工具箱。
 *   如果只读工具集定义在 factory.ts 里，就形成了循环依赖：
 *
 *     factory.ts → delegate.ts → factory.ts
 *
 *   循环依赖在 CommonJS 下不会立刻崩，但会拿到"半初始化"的模块 ——
 *   表现是"某个导出是 undefined"，而且报错位置离原因很远，极难排查。
 *
 *   所以把只读工具集抽到这个文件里：
 *     factory.ts    → readonlySet.ts
 *     delegate.ts   → readonlySet.ts
 *   依赖方向变成单向，干净。
 */

import { ToolRegistry } from './registry';
import { ReadFileTool } from './readFile';
import { GrepTool } from './grep';
import { GlobTool } from './glob';
import { ListDirTool } from './listDir';

/**
 * ⭐ 只读工具白名单 —— 子智能体专用
 *
 *   子智能体（delegate）绝对不能有写权限：
 *   它可能在你不知情的时候改掉你的文件。
 *
 *   ⚠️ 这个约束要【靠工具集本身】实现，不能靠 system prompt 里写
 *      "子 agent 不要改文件" —— 模型不听提示词，尤其是被诱导的时候。
 *      工具清单里没有写入工具 = 它物理上就改不了。
 *
 *   借鉴 goose 的 platform_extensions/summon.rs —— 子智能体也是普通工具，
 *   但它的能力被显式收窄。
 */
export const SUBAGENT_READONLY_TOOLS = ['read_file', 'grep', 'glob', 'list_dir'] as const;

/**
 * 只读工具集 —— 用于"只想让它看，不想让它动"的场景
 *   /doctor 检查、只读诊断、子智能体
 */
export function createReadOnlyRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new ReadFileTool());
  registry.register(new GrepTool());
  registry.register(new GlobTool());
  registry.register(new ListDirTool());
  return registry;
}
