/**
 * ToolRegistry：工具注册中心
 *
 * 职责：
 * - 注册所有工具（Map<name, Tool>）
 * - 提供 OpenAI 兼容 schema 给 LLM（调 tools 字段）
 * - 统一执行入口（含错误捕获）
 *
 * 错误处理设计（关键）：
 * - 工具不存在 / 工具崩了 → 返回 ToolResult(isError=true)
 * - **不 raise 出去**（raise 会让整个 agent 循环挂掉）
 * - LLM 看到 isError 会自动换策略（重试或换工具）
 * - 这是 AI agent "自我纠错" 的关键设计
 */

import { Tool, ToolResult, toOpenAISchema } from './base';

export type { ToolResult };

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  get names(): string[] {
    return Array.from(this.tools.keys());
  }

  /** 给 LLM 的工具清单 */
  get schemas(): Array<{ type: string; function: any }> {
    return Array.from(this.tools.values()).map(toOpenAISchema);
  }

  /**
   * 统一执行入口
   *
   * @param signal 可选的中断信号，会透传给工具（比如 run_shell 用来杀子进程）
   */
  async execute(name: string, args: any, signal?: AbortSignal): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      // 抄 nanobot registry.py:110：名字写错要给出"你是不是想用 X"+ 全部可用工具名，
      // 而不是干巴巴一句"工具不存在"——LLM 看到建议能自己纠正。
      const available = this.names.join(', ');
      return {
        content: `工具不存在: ${name}\n\n可用工具: ${available}\n（工具名必须完全一致，注意不要用中文名）`,
        isError: true,
      };
    }
    try {
      const result = await tool.execute(signal ? { ...args, signal } : args);
      return result;
    } catch (e: any) {
      // ⭐ 统一追加"换策略"提示（抄 nanobot execution.py:50 的 _RETRY_HINT）：
      //   LLM 看到工具失败时经常原样重试同一个错误参数，白烧 token。
      //   明确告诉它"换个做法"，自我纠错率明显更高。
      return {
        content:
          `${tool.name} 执行失败: ${e?.message || e}` +
          `\n\n[请分析上面的错误并换一个不同的做法，不要原样重试同样的参数]`,
        isError: true,
      };
    }
  }
}