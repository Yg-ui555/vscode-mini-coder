/**
 * Tool 抽象基类
 *
 * 底层原理（function calling 协议）：
 * - LLM 不会"直接执行"任何东西，它只是吐出一段结构化 JSON：
 *   { name: "read_file", arguments: { path: "main.py" } }
 * - 我们解析这段 JSON，按 name 找对应的 Tool 子类，调它的 execute()
 * - 工具的 description 和 parameters 必须给 LLM 看
 * - 写得差的 schema → LLM 调错工具
 *
 * 设计原则：
 * - Tool 是个抽象接口，子类实现 name/description/parameters/execute
 * - ToolResult 是字符串 + is_error 标志，让 LLM 能"看到错误"自我纠错
 */

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, any>;
  execute(args: any): Promise<ToolResult>;
}

/** 把 Tool 转成 OpenAI 兼容 schema（任何 OpenAI 协议 LLM 都能用） */
export function toOpenAISchema(tool: Tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}