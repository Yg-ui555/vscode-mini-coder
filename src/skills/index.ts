/**
 * 技能包（Skills）统一出口
 *
 * 借鉴分层：nanobot 的 skills.py 有三级来源
 *   workspace > plugin > builtin（同名时高优先级覆盖低优先级）
 * 本项目取两级，够用且清晰：
 *   workspace（用户的项目）> builtin（随扩展分发）
 *
 * 为什么需要 builtin 层：
 *   只支持工作区的话，用户第一次装上扩展时 skills/ 目录不存在，
 *   功能等于"没有"。内置几个开箱有用的技能（中文 commit 规范之类），
 *   既让功能立刻可见，也能当用户写自己技能的模板。
 *
 * 为什么 workspace 层优先：
 *   用户在自己项目里写的技能，应该能覆盖扩展内置的同名技能。
 *   这是"用户说了算"的基本原则。
 */

import * as path from 'path';
import { SkillEntry, SkillRequirements } from './types';
import {
  listSkills as listWorkspaceSkills,
  buildSkillsIndex,
  buildAlwaysSkillsBlock,
  buildExplicitSkillsBlock,
  readSkillBody,
  resolveExplicitSkills,
  checkRequirements,
  SKILLS_DIR,
} from './loader';
import { info } from '../logger';

export {
  buildSkillsIndex,
  buildAlwaysSkillsBlock,
  buildExplicitSkillsBlock,
  readSkillBody,
  resolveExplicitSkills,
  checkRequirements,
  SKILLS_DIR,
};
export { parseSkillMarkdown, SKILL_FILENAME } from './types';
export type { SkillEntry, SkillRequirements };

/** 内置技能目录名（相对扩展根目录） */
export const BUILTIN_SKILLS_DIR = 'skills';

/**
 * 发现全部技能（builtin + workspace 合并）
 *
 * @param workspaceRoot 工作区根；null 表示单文件模式，跳过 workspace 层
 * @param extensionPath 扩展安装目录，用于找 builtin 层；null 表示不加载 builtin
 */
export function listAllSkills(
  workspaceRoot?: string | null,
  extensionPath?: string | null,
): SkillEntry[] {
  const byName = new Map<string, SkillEntry>();

  // ── 第 1 层：内置（先加载，让工作区能覆盖）──
  if (extensionPath) {
    try {
      const builtinRoot = path.join(extensionPath, BUILTIN_SKILLS_DIR);
      const builtin = listWorkspaceSkills(builtinRoot);
      for (const e of builtin) {
        e.source = `builtin:${e.source}`;
        byName.set(e.name, e);
      }
    } catch {
      /* 内置目录不存在是正常的（源码模式下可能没打包），静默跳过 */
    }
  }

  // ── 第 2 层：工作区（同名覆盖）──
  if (workspaceRoot) {
    const workspaceSkills = listWorkspaceSkills(workspaceRoot);
    for (const e of workspaceSkills) {
      e.source = `workspace:${e.source}`;
      byName.set(e.name, e);
    }
  }

  // 排序规则跟 loader 里一致：always 优先，再按名字
  return [...byName.values()].sort((a, b) => {
    if (a.always !== b.always) return a.always ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** 记录一次发现结果到日志（激活时调一次，方便排障） */
export function logAllSkills(
  workspaceRoot?: string | null,
  extensionPath?: string | null,
): void {
  const entries = listAllSkills(workspaceRoot, extensionPath);
  if (entries.length === 0) {
    info('[skills] 未发现技能（扫描了内置目录与工作区 skills/ 目录）');
    return;
  }

  const always = entries.filter((e) => e.always).map((e) => e.name);
  const blocked = entries
    .filter((e) => !e.available)
    .map((e) => `${e.name}(${e.unavailableReason})`);
  const builtinCount = entries.filter((e) => e.source.startsWith('builtin')).length;
  const workspaceCount = entries.length - builtinCount;

  let line =
    `[skills] 共发现 ${entries.length} 个技能` +
    `（内置 ${builtinCount} / 工作区 ${workspaceCount}）`;
  if (always.length) line += `，always: ${always.join(', ')}`;
  if (blocked.length) line += `，不可用: ${blocked.join(', ')}`;

  info(line);
}

/** 给 /doctor 用的摘要（含两级来源） */
export function describeAllSkills(
  workspaceRoot?: string | null,
  extensionPath?: string | null,
): string {
  const entries = listAllSkills(workspaceRoot, extensionPath);
  if (entries.length === 0) {
    return (
      `未发现技能。\n` +
      `  · 工作区：<你的项目>/${SKILLS_DIR}/<技能名>/SKILL.md\n` +
      `  · 内置：扩展目录下的 ${BUILTIN_SKILLS_DIR}/\n` +
      `技能格式见 PROJECT.md「技能包」一节。`
    );
  }

  const lines = entries.map((e) => {
    const flags: string[] = [e.source.split(':')[0]];
    if (e.always) flags.push('always');
    if (!e.available) flags.push(`不可用：${e.unavailableReason}`);
    return `  • ${e.name} [${flags.join(', ')}]\n    ${e.description}\n    ${e.relPath}`;
  });

  const usable = entries.filter((e) => e.available).length;
  return `共 ${entries.length} 个技能（${usable} 个可用）:\n${lines.join('\n')}`;
}