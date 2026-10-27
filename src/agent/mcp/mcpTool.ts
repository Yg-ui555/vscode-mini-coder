/**
 * 把 MCP 服务器上的一个工具，包装成 mini-coder 的 Tool
 *
 * ─────────────────────────────────────────────────────────────
 * 大白话
 *
 *   LLM 只认 mini-coder 的 Tool 接口。
 *   MCP 的工具长得不一样（名字没有命名空间、参数说明是完整 JSON Schema、
 *   权限信息藏在 annotations 里），所以要套一层"翻译服"，
 *   让 LLM 以为它就是个普通工具。
 *
 * ─────────────────────────────────────────────────────────────
 * 三个关键设计（面试可讲）
 *
 *   1. 工具名必须带命名空间
 *      格式：mcp__<服务器名>__<工具名>
 *      · 防重名：两个服务器都可能提供 read_file
 *      · 模型能看出工具来自哪个服务器
 *      · ⭐ 你现有的 registry.resolveAlias() 已经支持这种带前缀的名字
 *        （它会取最后一段匹配），所以这是【免费的兼容性】
 *
 *   2. 权限靠白嫖 MCP 规范的 annotations
 *      readOnlyHint: true → 按只读处理（自动放行 + 允许并行）
 *      没说               → 按【写】处理（askWrites 档要确认）
 *
 *   3. 为什么不确定的 MCP 工具按"写"而不是按"执行"处理
 *      两者在权限表里的区别：
 *        kind='write' → askWrites 档【一律确认】
 *        kind='exec'  → askWrites 档只确认"命中高危特征"的
 *
 *      MCP 工具没有 command 字符串，detectDangerousCommand 判不了，
 *      按 exec 处理会变成【完全不确认】——
 *      而 MCP 服务器是外部程序，它的副作用我们完全不可控、
 *      checkpoint 也兜不住（它改的文件我们根本不知道是哪个）。
 *      所以按 write 处理：每次调用都要用户点头。
 *
 *      比喻：跑 shell 我们看得见命令，能判断危不危险；
 *      MCP 工具是个黑盒盒子，我们不知道里面装了什么 —— 那就一律先问。
 */

import { Tool, ToolResult } from '../tools/base';
import { ToolMeta, readOnlyMeta } from '../tools/meta';
import { McpStdioClient } from './stdioClient';
import { normalizeSchemaWithDefs } from './schemaNormalize';
import { McpToolDescriptor } from './protocol';

/**
 * MCP 工具的权限元数据
 *
 * ⚠️ 不用 writeMeta()，因为它 needsCheckpoint: true。
 *   checkpoint 是"把本地文件存一份快照"，对 MCP 服务器没有意义
 *   （它可能改任何文件，我们根本不知道是哪个，快照了也还原不回来）。
 */
function mcpWriteMeta(): ToolMeta {
  return {
    readOnly: false,
    destructive: true,
    concurrentSafe: false,
    needsCheckpoint: false,
    kind: 'write',
  };
}

/** 包装后的 MCP 工具 */
export class McpTool implements Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, any>;
  readonly meta: ToolMeta;

  /** 服务器侧的工具名（不带命名空间） */
  readonly serverToolName: string;

  constructor(
    private readonly client: McpStdioClient,
    serverName: string,
    private readonly tool: McpToolDescriptor,
  ) {
    this.serverToolName = tool.name;

    // ⭐ 工具名带命名空间
    this.name = `mcp__${serverName}__${tool.name}`;

    this.description =
      (tool.description ?? `MCP 工具 ${tool.name}`) +
      `\n\n（这是 MCP 服务器 "${serverName}" 提供的工具。` +
      `服务器是一个独立的外部程序，调用它会在那个程序里产生副作用。）`;

    // 参数说明翻译成后端认的格式（$ref 内联 / nullable 转换 / oneOf 降级）
    this.parameters = normalizeSchemaWithDefs(tool.inputSchema ?? {});

    // ⭐ 权限判定：白嫖 MCP 规范自带的 readOnlyHint
    //    没说 → 按"写"处理（每次都要用户确认）
    this.meta = tool.annotations?.readOnlyHint === true ? readOnlyMeta(true) : mcpWriteMeta();
  }

  async execute(args: any): Promise<ToolResult> {
    try {
      const text = await this.client.callTool(this.serverToolName, args ?? {});
      return { content: text };
    } catch (e: any) {
      // ⭐ 不要把异常抛出去 —— 抛出去整个 agent 循环就挂了。
      //    返回 isError，让 LLM 看到错误后自己换策略。
      //    （这跟 registry.execute() 里的统一错误处理是同一套思路）
      return {
        content:
          `MCP 工具 ${this.name} 执行失败: ${e?.message || e}\n\n` +
          `[请分析上面的错误并换一个不同的做法，不要原样重试同样的参数]`,
        isError: true,
      };
    }
  }
}
