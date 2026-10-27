/**
 * MCP 协议定义 —— JSON-RPC 2.0 over stdio
 *
 * ─────────────────────────────────────────────────────────────
 * 大白话
 *
 *   MCP 服务器就是一个【外部程序】。
 *   我们往它的"输入管道"（stdin）写一行 JSON，
 *   它从"输出管道"（stdout）吐一行 JSON。
 *
 *   跟 HTTP 无关，就是两个进程用管道说话。
 *
 *   整个协议只有三句话：
 *     1. initialize        握手："你好，我支持啥功能？"
 *     2. tools/list        "你有哪些工具？把说明书给我"
 *     3. tools/call        "帮我用一下这个工具，参数是这些"
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么叫 JSON-RPC
 *
 *   JSON-RPC 2.0 = "发问-回答"式通信格式。
 *   每条消息带一个 id，我们靠 id 把回答对回问题。
 *   ⭐ 为什么需要 id：应答可能【乱序到达】（服务器并发处理），
 *     没有 id 就不知道哪条回答对应哪个问题。
 *
 * ─────────────────────────────────────────────────────────────
 * 借鉴与取舍
 *
 *   nanobot 的 nanobot/agent/tools/mcp.py 有 2500 行，
 *   但那里面一半是 HTTP / SSE / OAuth / SSRF 防护 /
 *   7 家 provider 的 schema 归一化 —— 那是"全量矩阵"。
 *
 *   本项目只做【stdio 一条路】：
 *     · 覆盖 VS Code 生态里绝大多数本地 MCP server
 *       （filesystem / git / postgres / memory 都是本地进程）
 *     · 砍掉 70% 代码量和 90% 的边界情况
 *
 *   借鉴 nanobot 的部分：
 *     · schema 归一化（见 schemaNormalize.ts）—— 它的血泪教训
 *     · 工具名加命名空间前缀 —— 它的做法
 */

/** JSON-RPC 版本号（协议里写死的） */
export const JSONRPC_VERSION = '2.0' as const;

/** MCP 协议版本（本项目实现的版本） */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * 一条请求（我们发给服务器）
 *
 * @param id   请求编号，用来对答案
 * @param method 方法名，比如 'tools/list'
 */
export interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number;
  method: string;
  params?: unknown;
}

/**
 * 一条应答（服务器发回）
 *
 * ⭐ result 和 error 互斥：要么成功有 result，要么失败有 error。
 */
export interface JsonRpcResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * 一条通知（服务器主动发来，没有 id，我们不用回）
 *
 * 比如服务器说"我的工具列表变了"（tools/list_changed）。
 */
export interface JsonRpcNotification {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: unknown;
}

/** MCP 服务器可能返回的两种东西 */
export type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification;

/**
 * MCP 工具的说明书（我们从 tools/list 拿到的）
 *
 * ⭐ annotations 是 MCP 规范自带的标注，白嫖的：
 *   readOnlyHint: true → 这个工具不改东西
 *   我们直接用它做权限判定 —— 白嫖 MCP 规范的能力。
 */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  /** 参数说明，是一份完整 JSON Schema（可能带 $ref / $defs，坑很多） */
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/**
 * 初始化握手的结果
 *
 * 我们只关心 capabilities.tools —— 它决定服务器有没有工具。
 */
export interface McpInitializeResult {
  protocolVersion?: string;
  capabilities?: {
    tools?: { listChanged?: boolean };
    resources?: { subscribe?: boolean };
    prompts?: {};
  };
  serverInfo?: { name?: string; version?: string };
}

/**
 * tools/list 的结果
 */
export interface McpToolsListResult {
  tools?: McpToolDescriptor[];
}

/**
 * tools/call 的结果
 *
 * MCP 规定：结果是一个 content 数组，每个元素有 type 和 text。
 * 本项目只处理 type === 'text'，其它类型（图片 / 资源）先忽略。
 */
export interface McpToolCallResult {
  content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
}

/**
 * ⭐ 判断一条消息是不是【应答】（有 id）
 *
 * 用来把"应答"和"通知"分开：应答要按 id 配对，通知直接忽略。
 */
export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return typeof (msg as JsonRpcResponse).id === 'number';
}
