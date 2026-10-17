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

  /** 统一执行入口 */
  async execute(name: string, args: any): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `工具不存在: ${name}`, isError: true };
    }
    try {
      return await tool.execute(args);
    } catch (e: any) {
      return {
        content: `${tool.name} 执行失败: ${e?.message || e}`,
        isError: true,
      };
    }
  }
}