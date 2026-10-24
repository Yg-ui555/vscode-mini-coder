/**
 * Hook 配置加载
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 配置文件在哪
 *
 * 两个位置，【第一个存在的生效】（不合并 —— 合并会导致同一个 hook 跑两遍，
 * 而"跑两遍"对 Stop hook 意味着多花一倍的钱）：
 *
 *   1. <工作区>/.vscode/mini-coder-hooks.json   ← 推荐，可提交到 git，团队共享
 *   2. <工作区>/.mini-coder/hooks.json          ← 备选，插件自己的目录，本地私有
 *
 * 格式（抄 goose 的 .vscode/goose-hooks.json，改成 JSON 而非 JSONC）：
 *
 * ```json
 * {
 *   "hooks": {
 *     "PreToolUse": [
 *       {
 *         "matcher": "run_shell|write_file",
 *         "hooks": [{ "type": "command", "command": "npm run lint:staged" }]
 *       }
 *     ],
 *     "PostToolUse": [
 *       {
 *         "matcher": ".*",
 *         "hooks": [{ "type": "command", "command": "npx prettier --write ." }]
 *       }
 *     ],
 *     "Stop": [
 *       {
 *         "matcher": ".*",
 *         "hooks": [{ "type": "command", "command": "npm test" }]
 *       }
 *     ],
 *     "UserPromptSubmit": [
 *       {
 *         "matcher": ".*",
 *         "hooks": [{ "type": "command", "command": "git branch --show-current" }]
 *       }
 *     ]
 *   }
 * }
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';

import { HookEntry, HookEvent, HooksFile, HOOK_EVENTS } from './types';

/** 配置文件候选路径（按优先级） */
export function hookConfigPaths(root: string): string[] {
  return [
    path.join(root, '.vscode', 'mini-coder-hooks.json'),
    path.join(root, '.mini-coder', 'hooks.json'),
  ];
}

export interface LoadedHooks {
  /** 实际用了哪个文件（null = 没配置） */
  path: string | null;
  config: HooksFile;
  /** 配置有问题的地方（只记日志，不阻断） */
  problems: string[];
}

/**
 * 读 hook 配置
 *
 * ⚠️ 配置读不出来【不是错误】 —— 那就是"用户没配 hook"，
 *    agent 照常干活。配置写错了也只记日志，不让 agent 起不来。
 */
export function loadHooksConfig(root: string): LoadedHooks {
  const problems: string[] = [];

  for (const p of hookConfigPaths(root)) {
    if (!fs.existsSync(p)) continue;

    let raw: string;
    try {
      raw = fs.readFileSync(p, 'utf-8');
    } catch (e: any) {
      problems.push(`读不了 ${p}：${e?.message}`);
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (e: any) {
      problems.push(`${p} 不是合法 JSON：${e?.message}`);
      continue;
    }

    const config = normalize(parsed, p, problems);
    return { path: p, config, problems };
  }

  return { path: null, config: {}, problems };
}

/** 校验并规整配置结构 */
function normalize(parsed: any, file: string, problems: string[]): HooksFile {
  if (!parsed || typeof parsed !== 'object') {
    problems.push(`${file} 顶层不是对象`);
    return {};
  }

  const rawHooks = parsed.hooks;
  if (!rawHooks || typeof rawHooks !== 'object') {
    problems.push(`${file} 里没有 hooks 字段`);
    return {};
  }

  const hooks: Partial<Record<HookEvent, HookEntry[]>> = {};
  for (const event of HOOK_EVENTS) {
    const entries = rawHooks[event];
    if (entries === undefined) continue;

    if (!Array.isArray(entries)) {
      problems.push(`${file} 的 ${event} 不是数组`);
      continue;
    }

    const valid: HookEntry[] = [];
    for (const e of entries) {
      if (!e || typeof e !== 'object' || !Array.isArray(e.hooks)) {
        problems.push(`${file} 的 ${event} 里有条目格式不对（缺 hooks 数组）`);
        continue;
      }
      const cmds = e.hooks.filter((c: any) => c && c.type === 'command' && typeof c.command === 'string');
      if (cmds.length === 0) {
        problems.push(`${file} 的 ${event} 里有条目没有可执行的 command`);
        continue;
      }
      valid.push({ matcher: e.matcher, hooks: cmds });
    }

    if (valid.length > 0) hooks[event] = valid;
  }

  return { hooks };
}

/**
 * 编译 matcher
 *
 * ⚠️ 用户写的正则可能是坏的 —— 坏正则不能让整个 hook 系统挂掉，
 *    那样用户改配置就能把 agent 弄死。
 *    编译失败就当作"不匹配任何东西"，并记一条问题。
 */
export function compileMatcher(matcher: string | undefined): RegExp | null {
  if (!matcher) return null;
  try {
    return new RegExp(matcher);
  } catch {
    return null;
  }
}

/**
 * 判断一个 hook 条目是否适用于当前主体
 *
 * @param entry     hook 条目
 * @param subject   匹配对象（工具名 / agent 最后那段话 / 用户输入）
 */
export function entryMatches(entry: HookEntry, subject: string): boolean {
  if (!entry.matcher) return true; // 没写 matcher = 匹配全部
  const re = compileMatcher(entry.matcher);
  if (!re) return false; // 坏正则 = 不匹配（而不是全匹配）
  try {
    return re.test(subject);
  } catch {
    return false;
  }
}

/** 取某个事件下的所有条目 */
export function entriesFor(config: HooksFile, event: HookEvent): HookEntry[] {
  return config.hooks?.[event] ?? [];
}
