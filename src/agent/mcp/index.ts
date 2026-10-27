/**
 * MCP 模块的对外出口
 *
 * 只导出"别人需要的"，内部实现（protocol / schemaNormalize）
 * 由各自的调用方直接 import。
 */

export {
  McpStdioClient,
  DEFAULT_MCP_TIMEOUT_MS,
  type McpServerConfig,
} from './stdioClient';

export { McpTool } from './mcpTool';

export { McpManager, type McpServerResult } from './manager';

export {
  collectMcpConfigs,
  readMcpConfigFile,
  parseServers,
  substituteVars,
  WORKSPACE_MCP_CONFIG,
  GLOBAL_MCP_CONFIG,
  type McpConfigFile,
} from './config';

export {
  normalizeSchema,
  normalizeSchemaWithDefs,
} from './schemaNormalize';

export {
  JSONRPC_VERSION,
  MCP_PROTOCOL_VERSION,
  isResponse,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  type JsonRpcMessage,
  type McpToolDescriptor,
  type McpToolsListResult,
  type McpToolCallResult,
  type McpInitializeResult,
} from './protocol';
