/**
 * ToolRegistry：工具注册中心
 *
 * 职责：
 * - 注册所有工具（Map<name, Tool>）
 * - 提供 OpenAI 兼容 schema 给 LLM（调 tools 字段）
 * - 统一执行入口（含错误捕获 + 名字口误纠正 + 调用追踪）
 *
 * 错误处理设计（关键）：
 * - 工具不存在 / 工具崩了 → 返回 ToolResult(isError=true)
 * - **不 raise 出去**（raise 会让整个 agent 循环挂掉）
 * - LLM 看到 isError 会自动换策略（重试或换工具）
 * - 这是 AI agent "自我纠错" 的关键设计
 */

import { Tool, ToolResult, toOpenAISchema } from './base';
import { getSpanRecorder } from '../../observability/spans';

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
   * ⭐ 工具名"口误"自动纠正
   *
   *   借鉴 goose 的 recover_mangled_tool_name
   *   （crates/goose/src/agents/extension_manager/mod.rs:443-483）
   *
   *   这是【生产环境才会暴露】的问题：
   *     模型经常把工具名写成 `functions.read_file`（带 OpenAI 的前缀）、
   *     `read-file`（下划线写成连字符）、`readFile`（驼峰）。
   *     每次都要浪费一整轮 LLM 往返去纠正。
   *
   *   比喻：员工把工单上的工具名抄错了一个字符，
   *         以前要退回让他重抄，现在系统自动认出来。
   *
   * @returns 纠正后的真实工具名；纠正不了返回 null
   */
  resolveAlias(name: string): string | null {
    if (this.tools.has(name)) return name;

    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = norm(name);
    if (!target) return null;

    for (const key of this.tools.keys()) {
      const k = norm(key);
      // 完全一致（忽略大小写 / 下划线 / 连字符）
      if (k === target) return key;
      // 带 functions_ / tools_ 前缀
      if (k.replace(/^(functions|tools)_/, '') === target) return key;
      // 带命名空间前缀（xxx__yyy）
      if (k.split('__').pop() === target) return key;
    }
    return null;
  }

  /**
   * 统一执行入口
   *
   * @param signal 可选的中断信号，会透传给工具（比如 run_shell 用来杀子进程）
   */
  async execute(name: string, args: any, signal?: AbortSignal): Promise<ToolResult> {
    // ⭐ 调用追踪：每次工具调用一个 span
    //   字段名对齐 OTel GenAI 语义约定
    const rec = getSpanRecorder();
    const spanId = rec.start('gen_ai.tool', {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': name,
    });
    const startedAt = Date.now();

    try {
      const result = await this._execute(name, args, signal);
      rec.end(spanId, {
        durationMs: Date.now() - startedAt,
        attributes: {
          'gen_ai.tool.is_error': !!result.isError,
          'gen_ai.tool.result_length': result.content?.length ?? 0,
        },
      });
      return result;
    } catch (e: any) {
      rec.end(spanId, { error: e?.message || String(e), durationMs: Date.now() - startedAt });
      throw e;
    }
  }

  /** 真正的执行逻辑 */
  private async _execute(name: string, args: any, signal?: AbortSignal): Promise<ToolResult> {
    // ⭐ 先试着纠正工具名的"口误"
    const resolved = this.resolveAlias(name);
    const toolName = resolved ?? name;
    const tool = this.tools.get(toolName);

    if (!tool) {
      // 抄 nanobot registry.py:110：名字写错要给出"你是不是想用 X"+ 全部可用工具名，
      // 而不是干巴巴一句"工具不存在"——LLM 看到建议能自己纠正。
      const available = this.names.join(', ');
      return {
        content: `工具不存在: ${name}\n\n可用工具: ${available}\n（工具名必须完全一致，注意不要用中文名）`,
        isError: true,
      };
    }

    // ⭐ 口误纠正成功了 → 明确告诉模型"我认出了你的笔误"
    //   不告诉它的话，它会以为工具名本来就长那样，
    //   后面每一轮都这么写 —— 纠正只生效一次，没有意义。
    const aliasNote =
      resolved && resolved !== name
        ? `\n\n[注意：你写的是 "${name}"，我已识别为 "${resolved}"。以后请直接用 "${resolved}"。]`
        : '';

    try {
      const result = await tool.execute(signal ? { ...args, signal } : args);
      return aliasNote ? { ...result, content: result.content + aliasNote } : result;
    } catch (e: any) {
      // ⭐ 统一追加"换策略"提示（抄 nanobot execution.py:50 的 _RETRY_HINT）：
      //   LLM 看到工具失败时经常原样重试同一个错误参数，白烧 token。
      //   明确告诉它"换个做法"，自我纠错率明显更高。
      return {
        content:
          `${tool.name} 执行失败: ${e?.message || e}` +
          `\n\n[请分析上面的错误并换一个不同的做法，不要原样重试同样的参数]` +
          aliasNote,
        isError: true,
      };
    }
  }
}
