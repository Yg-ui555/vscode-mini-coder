/**
 * MCP 服务器管理器
 *
 * ─────────────────────────────────────────────────────────────
 * 大白话
 *
 *   管好几个 MCP 服务器，把它们的工具都注册进 ToolRegistry。
 *
 * ⭐ 最重要的设计原则：【一个服务器挂掉，不能影响其他的】
 *
 *   比喻：外卖少点一家，不影响吃饭。
 *   不能因为一个第三方服务器起不来，整个 agent 就瘫痪了 ——
 *   那用户会觉得"装了个 MCP 插件，agent 就不能用了"，比不装还糟。
 *
 * ─────────────────────────────────────────────────────────────
 * 工具是怎么进到 LLM 眼里的
 *
 *   McpManager.startAll() → 把工具 register 进 registry
 *   registry.schemas 是【每次调 LLM 实时计算】的
 *   （见 src/agent/operations/inference.ts:65）
 *
 *   所以：MCP 服务器在【运行时】才吐出来的工具，
 *   下一轮 LLM 调用自动就带上了 —— 不用重启对话。
 *
 *   这就是为什么 MCP 接入不需要改架构。
 */

import { Tool } from '../tools/base';
import { ToolRegistry } from '../tools/registry';
import { McpStdioClient, McpServerConfig } from './stdioClient';
import { McpTool } from './mcpTool';
import { warn, info } from '../../logger';

/** 一个服务器启动的结果 */
export interface McpServerResult {
  name: string;
  ok: boolean;
  toolCount: number;
  error?: string;
}

export class McpManager {
  private readonly clients = new Map<string, McpStdioClient>();
  private readonly tools: Tool[] = [];

  /**
   * 启动所有服务器，把工具注册进 registry
   *
   * @param configs  服务器配置列表
   * @param registry 工具注册表（可传 undefined 只启动不注册）
   */
  async startAll(
    configs: McpServerConfig[],
    registry?: ToolRegistry,
  ): Promise<McpServerResult[]> {
    const results: McpServerResult[] = [];

    for (const cfg of configs) {
      try {
        const client = new McpStdioClient(cfg);
        await client.start();
        this.clients.set(cfg.name, client);

        const serverTools = client.getTools();
        for (const t of serverTools) {
          const tool = new McpTool(client, cfg.name, t);
          this.tools.push(tool);
          registry?.register(tool);
        }

        info(
          `[MCP] 服务器 "${cfg.name}" 启动成功，${serverTools.length} 个工具已注册`,
        );
        results.push({ name: cfg.name, ok: true, toolCount: serverTools.length });
      } catch (e: any) {
        // ⭐ 关键：记个警告，继续下一个
        //    绝对不能 throw —— 一个服务器挂了就全瘫，是很蠢的设计
        const msg = e?.message || String(e);
        warn(`[MCP] 服务器 "${cfg.name}" 启动失败（已跳过，不影响其他工具）: ${msg}`);
        results.push({ name: cfg.name, ok: false, toolCount: 0, error: msg });
      }
    }

    return results;
  }

  /**
   * 拿到所有 MCP 工具
   *
   * ⭐ 这个方法是给"注册表是一次性创建的"场景准备的：
   *   聊天面板在打开时就 createDefaultRegistry() 了，
   *   那时候 MCP 服务器可能还没起来。
   *   所以面板创建注册表之后，要用这个方法把 MCP 工具补进去。
   */
  getTools(): Tool[] {
    return [...this.tools];
  }

  /** 工具名清单（给 /doctor 和日志用） */
  getToolNames(): string[] {
    return this.tools.map((t) => t.name);
  }

  /** 已成功启动的服务器名 */
  getServerNames(): string[] {
    return [...this.clients.keys()];
  }

  /**
   * 扩展停用时调用 —— 清理所有子进程
   *
   * ⚠️ 不调用会留下孤儿进程（用户会看到一堆 node 进程残留）。
   */
  async stopAll(): Promise<void> {
    for (const [, client] of this.clients) {
      try {
        await client.stop();
      } catch {
        /* 已经死了就算了 */
      }
    }
    this.clients.clear();
    this.tools.length = 0;
  }
}

/**
 * ⭐ 全局管理器引用
 *
 * 为什么用模块级单例（跟 setWorkspaceRoot / setDelegateRuntime 同一套模式）：
 *   · 扩展激活时启动 MCP 服务器（extension.ts）
 *   · 聊天面板打开时创建工具注册表（webview/panel.ts）
 *   · 这两处隔得很远，需要一个共享的引用
 *
 * ⚠️ 但【工具本身不是全局的】——
 *   工具通过 createDefaultRegistry({ extraTools }) 显式传进去，
 *   评测沙箱不传，所以评测结果依然可复现。
 */
let globalManager: McpManager | null = null;

export function setMcpManager(m: McpManager | null): void {
  globalManager = m;
}

export function getMcpManager(): McpManager | null {
  return globalManager;
}

/** 拿到当前可用的 MCP 工具（没有管理器就返回空数组） */
export function getMcpTools(): Tool[] {
  return globalManager ? globalManager.getTools() : [];
}
