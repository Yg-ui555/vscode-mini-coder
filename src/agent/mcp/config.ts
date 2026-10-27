/**
 * MCP 配置的读取与解析
 *
 * ─────────────────────────────────────────────────────────────
 * 配置文件在哪
 *
 *   工作区级：<workspaceRoot>/.vscode/mini-coder-mcp.json   ← 提交进 git，团队共享
 *   全局级：  <globalStorageUri>/mcp.json                    ← 换仓库也保留
 *
 * ⭐ 选 .vscode/ 是因为 VS Code 生态的用户已经熟悉这个路径，
 *   不用学新约定。（跟 .vscode/settings.json 同理）
 *
 * ─────────────────────────────────────────────────────────────
 * 格式
 *
 *   {
 *     "servers": [
 *       {
 *         "name": "filesystem",
 *         "command": "npx",
 *         "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"],
 *         "env": { "ROOT": "${workspaceFolder}" }
 *       }
 *     ]
 *   }
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ ${workspaceFolder} 变量替换
 *
 *   这是 VS Code 生态的标准写法（tasks.json / launch.json 都用它），
 *   用户已经会了。绝对不要自己发明一套路径语法。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 安全：配置里的东西会被【执行】
 *
 *   command + args 会被 spawn 成本地进程。
 *   所以：
 *     · 只从本地配置文件读（不读网络）
 *     · 变量替换只支持 ${workspaceFolder}，不支持任意表达式
 *     · env 里的值不写进日志（复用 redact.ts 的脱敏逻辑）
 */

import * as fs from 'fs';
import * as path from 'path';
import { McpServerConfig } from './stdioClient';

/** 配置文件名（工作区级） */
export const WORKSPACE_MCP_CONFIG = path.join('.vscode', 'mini-coder-mcp.json');

/** 配置文件名（全局级） */
export const GLOBAL_MCP_CONFIG = 'mcp.json';

/** 一份原始配置的形状 */
export interface McpConfigFile {
  servers?: Array<{
    name?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    timeoutMs?: number;
    enabled?: boolean;
  }>;
}

/**
 * ⭐ 变量替换
 *
 * 只支持 ${workspaceFolder} —— 就这一个。
 * 支持任意表达式就等于支持 `$(rm -rf /)`，那是命令注入。
 */
export function substituteVars(
  value: string,
  workspaceRoot: string | null,
): string {
  if (!value.includes('${workspaceFolder}')) return value;
  const root = workspaceRoot ?? process.cwd();
  return value.split('${workspaceFolder}').join(root);
}

/**
 * 读一个配置文件
 *
 * @returns 解析后的服务器配置列表（配置不存在或坏了都返回空数组，不抛错）
 */
export function readMcpConfigFile(
  filePath: string,
  workspaceRoot: string | null,
): McpServerConfig[] {
  let raw: string;
  try {
    if (!fs.existsSync(filePath)) return [];
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  let parsed: McpConfigFile;
  try {
    parsed = JSON.parse(raw) as McpConfigFile;
  } catch (e: any) {
    // ⚠️ 配置坏了不能拖垮 agent —— 记个提示，跳过这个文件
    console.warn(
      `[Mini-Coder] MCP 配置解析失败（已跳过）: ${filePath} —— ${e?.message || e}`,
    );
    return [];
  }

  return parseServers(parsed, workspaceRoot);
}

/**
 * 把配置文件的原始形状转成内部结构
 *
 * ⭐ 所有非法条目【静默跳过】，不抛错。
 *   一个写错的条目不该让整个 MCP 功能不可用。
 */
export function parseServers(
  config: McpConfigFile,
  workspaceRoot: string | null,
): McpServerConfig[] {
  const list = Array.isArray(config?.servers) ? config.servers : [];
  const out: McpServerConfig[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    if (item.enabled === false) continue;                 // 显式禁用
    if (typeof item.name !== 'string' || !item.name.trim()) continue;
    if (typeof item.command !== 'string' || !item.command.trim()) continue;

    const name = item.name.trim();
    // 重名 → 跳过后来的（保持第一个）
    if (seen.has(name)) continue;
    seen.add(name);

    const args = Array.isArray(item.args)
      ? item.args
          .filter((a): a is string => typeof a === 'string')
          .map((a) => substituteVars(a, workspaceRoot))
      : [];

    const env: Record<string, string> = {};
    if (item.env && typeof item.env === 'object') {
      for (const [k, v] of Object.entries(item.env)) {
        if (typeof v === 'string') env[k] = substituteVars(v, workspaceRoot);
      }
    }

    const cfg: McpServerConfig = {
      name,
      command: substituteVars(item.command.trim(), workspaceRoot),
      args,
      env,
    };
    if (typeof item.timeoutMs === 'number' && item.timeoutMs > 0) {
      cfg.timeoutMs = item.timeoutMs;
    }
    if (workspaceRoot) cfg.cwd = workspaceRoot;

    out.push(cfg);
  }

  return out;
}

/**
 * 汇总所有来源的 MCP 配置
 *
 * 优先级：全局级 < 工作区级（同名时工作区级覆盖全局级）
 *
 * @param workspaceRoot 工作区根目录
 * @param globalConfigPath 全局配置文件路径（可能是 undefined）
 */
export function collectMcpConfigs(
  workspaceRoot: string | null,
  globalConfigPath?: string,
): McpServerConfig[] {
  const all: McpServerConfig[] = [];

  if (globalConfigPath) {
    all.push(...readMcpConfigFile(globalConfigPath, workspaceRoot));
  }
  if (workspaceRoot) {
    all.push(
      ...readMcpConfigFile(
        path.join(workspaceRoot, WORKSPACE_MCP_CONFIG),
        workspaceRoot,
      ),
    );
  }

  // 同名去重：后出现的（工作区级）覆盖先出现的（全局级）
  const byName = new Map<string, McpServerConfig>();
  for (const s of all) byName.set(s.name, s);
  return [...byName.values()];
}
