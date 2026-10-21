/**
 * 路径边界检查 —— 防止 LLM 把文件写到工作区外面
 *
 * 为什么需要：
 * LLM 是根据自然语言猜路径的，它可能：
 *   - 写 "../../../.ssh/config"（用户 SSH 私钥配置）
 *   - 写 "C:/Windows/System32/x.txt"（系统目录）
 *   - 误判某个文件路径
 * 这不是恶意假设，是真实会发生的事——LLM 猜错路径的概率不低，
 * 而"猜错"的后果是静默覆盖用户文件。
 *
 * 类比：给 AI 一个仓库管理员角色，但只能进仓库大门。
 *      现在我们是给了它整台电脑的钥匙。
 *
 * 原理：
 * path.resolve(p) 把 p 转成绝对路径并消掉 ../
 * path.relative(root, target) 如果以 ".." 开头或本身是绝对路径，
 *   说明 target 在 root 之外
 *
 * 与 nanobot/goose 对标：
 *   nanobot 用 sandbox 目录 + workspace_violation_counts（反复越界会升级提示）
 *   goose 靠权限确认机制兜底
 *   我们两层都做：路径边界（硬拦截）+ 写操作确认（用户知情）
 */

import * as path from 'path';

export interface PathCheck {
  ok: boolean;
  resolved: string;
  error?: string;
}

/**
 * 取当前工作区根目录。
 *
 * 用 require 而不是 import：vitest 测试环境没有 vscode 模块，
 * 顶层 import 会直接让所有工具测试挂掉。
 * 运行时（有 vscode）正常返回；测试时 catch 住返回 undefined → 降级为不检查。
 */
function getWorkspaceRoot(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require('vscode');
    return vscode.workspace?.workspaceFolders?.[0]?.uri?.fsPath;
  } catch {
    return undefined;
  }
}

/** 允许通过 setWorkspaceRoot 显式指定（测试 / 多工作区场景） */
let explicitRoot: string | undefined;

export function setWorkspaceRoot(root: string | undefined): void {
  explicitRoot = root;
}

export function getWorkspaceRootSafe(): string | undefined {
  return explicitRoot ?? getWorkspaceRoot();
}

/**
 * 解析路径并校验是否在工作区内
 *
 * 规则：
 * 1. 有工作区 → 必须落在工作区内，否则拒绝
 * 2. 无工作区（单文件模式 / 测试环境）→ 只允许相对路径，
 *    绝对路径一律拒绝（没有边界可依，放行等于没检查）
 *
 * @param input LLM 给的路径（相对或绝对）
 * @param allowOutside 显式放行（目前没有工具需要，留给未来的"用户手动指定文件"场景）
 */
export function resolveInWorkspace(input: string, allowOutside = false): PathCheck {
  if (!input || typeof input !== 'string') {
    return { ok: false, resolved: '', error: '路径为空' };
  }

  const resolved = path.resolve(input);

  if (allowOutside) {
    return { ok: true, resolved };
  }

  const root = getWorkspaceRootSafe();

  // 无工作区：只放行相对路径
  if (!root) {
    if (path.isAbsolute(input)) {
      return {
        ok: false,
        resolved,
        error:
          `当前没有打开文件夹，无法确认 ${input} 是否安全。请先在 VS Code 里打开项目文件夹，或改用相对路径。`,
      };
    }
    return { ok: true, resolved };
  }

  // 有工作区：必须在边界内
  const rootResolved = path.resolve(root);
  const rel = path.relative(rootResolved, resolved);

  // rel 以 ".." 开头 → 在外面；rel 本身是绝对路径 → 跨盘符，也在外面
  const outside = rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel);

  if (outside) {
    return {
      ok: false,
      resolved,
      error:
        `路径 ${input} 超出了工作区范围（工作区：${rootResolved}）。` +
        `只允许读写工作区内的文件，请改用相对工作区根目录的路径，例如 "src/${path.basename(input)}"。`,
    };
  }

  return { ok: true, resolved };
}

/**
 * 把路径显示成给 LLM 看的形式（相对工作区根，更短更易读）
 */
export function toWorkspaceRelative(absolutePath: string): string {
  const root = getWorkspaceRootSafe();
  if (!root) return absolutePath;
  const rel = path.relative(path.resolve(root), absolutePath);
  return rel && !rel.startsWith('..') ? rel : absolutePath;
}