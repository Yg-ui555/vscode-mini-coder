/**
 * 技能包加载器
 *
 * 负责四件事：
 *   1. 发现   —— 扫描 <workspace>/skills/<name>/SKILL.md
 *   2. 门控   —— 检查 requires（CLI / 环境变量）是否满足
 *   3. 索引   —— 造给 system prompt 的"目录卡"（渐进式加载的核心）
 *   4. 触发   —— 解析用户消息里的 $skill-name，按需注入正文
 *
 * 设计取舍记录：
 *   · 技能名限定 ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$
 *     —— 技能名会变成 read_file 的路径一段，也会出现在 $触发 里，
 *        必须排除空格、斜杠、大写等会引发路径或正则问题的字符。
 *        nanobot 的 valid_skill_metadata 用了同样的规则，抄的。
 *   · 单个技能文件损坏时跳过它，不能连累整批发现
 *     —— 用户自己写的 .md 出现意外是常态，不是异常。
 *   · description 缺失时用目录名兜底，但记一条日志
 *     —— 索引里没有说明的技能等于不存在，模型不会选它。
 */

import * as fs from 'fs';
import * as path from 'path';
import { SkillEntry, SkillRequirements, parseSkillMarkdown, SKILL_FILENAME } from './types';
import { getDefaultCwd } from '../agent/tools/paths';
import { info, warn } from '../logger';

/** 技能目录名（相对工作区） */
export const SKILLS_DIR = 'skills';

/** 技能名的合法格式：只允许小写字母、数字、连字符 */
const VALID_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** 技能名长度上限（防止超长路径 / 超长 $触发） */
const MAX_NAME_LEN = 64;

/** 单个技能正文大小上限：60KB。超了就是写错了，不该塞进 prompt */
const MAX_BODY_BYTES = 60 * 1024;

/**
 * $技能名 引用语法
 *
 * 抄 nanobot 的正则：/(?<![\w$])\$([A-Za-z0-9_-]+)/
 *
 * 那个 (?<![\w$]) 是负向回顾断言（negative lookbehind）：
 *   "价格是 $100" 里的 $100 不该被当成技能引用
 *   "cost$USD"    里的 $USD 也不该
 *   所以要求 $ 前面【不能】是单词字符或另一个 $。
 *
 * 这里放宽了大小写（允许 $Skill-Name），因为技能名本身已经限定小写，
 * 真正匹配时还会再按已发现的技能表过滤一次。
 */
const SKILL_REFERENCE = /(?<![\w$])\$([A-Za-z0-9_-]+)/g;

/** 检查命令行工具是否存在 */
function hasBinary(name: string): boolean {
  // Windows 下 where，Unix 下 which。用 PATH 扫描实现，避免引第三方库。
  const pathEnv = process.env.PATH || '';
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
      : [''];

  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        if (fs.existsSync(path.join(dir, name + ext))) return true;
      } catch {
        /* 某个 PATH 项不可访问就跳过 */
      }
    }
  }
  return false;
}

/** 检查环境变量是否已设置（非空字符串才算） */
function hasEnv(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0;
}

/**
 * 检查技能的前置条件
 * @returns 满足时返回 undefined，否则返回人类可读的不满足原因
 */
export function checkRequirements(req: SkillRequirements | undefined): string | undefined {
  if (!req) return undefined;

  const missing: string[] = [];

  for (const bin of req.bins || []) {
    if (bin && !hasBinary(bin)) missing.push(`CLI: ${bin}`);
  }
  for (const env of req.env || []) {
    if (env && !hasEnv(env)) missing.push(`ENV: ${env}`);
  }

  return missing.length > 0 ? missing.join('、') : undefined;
}

/** 技能目录的绝对路径 */
function skillsRoot(): string {
  return path.join(getDefaultCwd(), SKILLS_DIR);
}

/**
 * 发现所有技能
 *
 * @param workspace 传 null 时用 getDefaultCwd()；测试时传临时目录
 */
export function listSkills(workspace?: string | null): SkillEntry[] {
  const root = workspace ? path.join(workspace, SKILLS_DIR) : skillsRoot();

  let dirs: string[] = [];
  try {
    if (!fs.existsSync(root)) return [];
    dirs = fs.readdirSync(root);
  } catch (e: any) {
    warn(`[skills] 读取技能目录失败：${e?.message || e}`);
    return [];
  }

  const entries: SkillEntry[] = [];

  for (const dirName of dirs) {
    // ── 名字合法性 ──
    if (!VALID_NAME.test(dirName) || dirName.length > MAX_NAME_LEN) {
      warn(
        `[skills] 跳过 ${dirName}/：技能名只能是小写字母、数字、连字符` +
          `（不能有空格、斜杠、大写），且不超过 ${MAX_NAME_LEN} 字符`,
      );
      continue;
    }

    const skillFile = path.join(root, dirName, SKILL_FILENAME);

    // ── 文件必须存在且是文件 ──
    try {
      if (!fs.statSync(skillFile).isFile()) continue;
    } catch {
      continue; // 没有 SKILL.md 的目录不是技能，静默跳过（很常见）
    }

    // ── 读 + 解析（单文件坏了只跳过它，不能连累整批）──
    let meta: ReturnType<typeof parseSkillMarkdown>['meta'];
    try {
      const raw = fs.readFileSync(skillFile, 'utf-8');
      meta = parseSkillMarkdown(raw).meta;
    } catch (e: any) {
      warn(`[skills] 跳过 ${dirName}/：读取 ${SKILL_FILENAME} 失败：${e?.message || e}`);
      continue;
    }

    const description = (meta.description || '').trim();
    if (!description) {
      warn(
        `[skills] 技能 ${dirName} 没有写 description，它在索引里等于不存在。` +
          `请在 ${SKILLS_DIR}/${dirName}/${SKILL_FILENAME} 的 frontmatter 里补上。`,
      );
    }

    const unavailable = checkRequirements(meta.requires);
    const absPath = path.resolve(skillFile);
    // ⭐ relPath 统一成【相对工作区 + 正斜杠】的格式，两个原因：
    //   1. 不能因为调用方式不同就一个绝对一个相对 —— 它要写进 system prompt
    //      给模型 read_file 用，格式稳定才好读、也才测得准
    //   2. 强制用正斜杠而不是 path.join 的结果：Windows 上 path.join 会产出
    //      反斜杠（skills\a\SKILL.md），而正斜杠在所有平台上都能用，
    //      跟项目里 buildTestCommand 的处理方式也是一致的
    const relPath = `${SKILLS_DIR}/${dirName}/${SKILL_FILENAME}`;

    entries.push({
      name: (meta.name || dirName).trim() || dirName,
      absPath,
      relPath,
      source: dirName,
      description: description || '(这个技能没写说明)',
      always: meta.always === true,
      requires: meta.requires || {},
      available: !unavailable,
      unavailableReason: unavailable,
    });
  }

  // 排序：always 优先，其次按名字 —— 稳定顺序对 prompt cache 友好
  return entries.sort((a, b) => {
    if (a.always !== b.always) return a.always ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * 造 system prompt 里的技能索引（渐进式加载的核心产物）
 *
 * ⭐ 这里是省 token 的关键：只放一行行摘要，正文一律不给。
 *
 *   为什么不直接注入 always 技能之外的正文：
 *     一个技能正文按 1500 字算，20 个技能就是 3 万 token，
 *     而 ReAct 循环每轮都要重发 —— 跑 20 轮光这一项 60 万 token。
 *     评测报告里"输入 token 是输出的 20 倍"就是这么来的。
 *
 *   模型想看细节时自己 read_file 那个 SKILL.md。
 *
 * @param entries 已经 listSkills() 出来的技能
 * @returns Markdown 片段；没有技能时返回空串
 */
export function buildSkillsIndex(entries: SkillEntry[]): string {
  // 索引里只列"可用"的技能。
  // 不可用的（缺 CLI / 缺环境变量）只在有其它技能时才附一句提示，
  // 避免模型去调一个必然失败的东西。
  const usable = entries.filter((e) => e.available);
  const unusable = entries.filter((e) => !e.available);

  if (usable.length === 0 && unusable.length === 0) return '';

  const lines: string[] = [];

  if (usable.length > 0) {
    lines.push('以下是本项目可用的技能（每条一行索引，不是完整说明）：');
    lines.push('');
    for (const e of usable) {
      lines.push(`- **${e.name}** — ${e.description}  \`${e.relPath}\``);
    }
    lines.push('');
    lines.push(
      '当你需要某个技能的详细说明（步骤、命令、注意事项）时，' +
        '用 read_file 读取对应的 SKILL.md。**不要凭索引猜内容**，也不要一次性把所有 SKILL.md 都读回来。',
    );
  }

  if (unusable.length > 0) {
    lines.push('');
    lines.push('以下技能因缺少前置条件而不可用，不要尝试使用：');
    for (const e of unusable) {
      lines.push(`- ${e.name}（需要 ${e.unavailableReason}）`);
    }
  }

  return lines.join('\n');
}

/**
 * 造 always 技能的全量正文块
 *
 * always: true 的技能正文要完整进 system prompt。
 * 适合"这个项目所有任务都必须遵守"的硬规矩
 * （比如"所有提交信息必须中文"），不适合具体任务指南。
 */
export function buildAlwaysSkillsBlock(entries: SkillEntry[]): string {
  const alwaysOnes = entries.filter((e) => e.available && e.always);
  if (alwaysOnes.length === 0) return '';

  const parts: string[] = [];
  for (const e of alwaysOnes) {
    const body = readSkillBody(e);
    if (!body) continue;
    parts.push(`## 技能：${e.name}\n\n${body}`);
  }

  if (parts.length === 0) return '';

  return `# 本项目强制技能（always）\n\n> 这些规则在所有任务里都适用，请严格遵守。\n\n${parts.join('\n\n---\n\n')}`;
}

/**
 * 读取技能正文（剥掉 frontmatter）
 *
 * @returns 正文；读不到返回空串
 */
export function readSkillBody(entry: SkillEntry): string {
  try {
    const stat = fs.statSync(entry.absPath);
    if (stat.size > MAX_BODY_BYTES) {
      warn(
        `[skills] 技能 ${entry.name} 有 ${stat.size} 字节，超过 ${MAX_BODY_BYTES} 上限，已跳过加载。` +
          `（这么大通常是写错了，技能说明不该是长文）`,
      );
      return '';
    }
    const raw = fs.readFileSync(entry.absPath, 'utf-8');
    return parseSkillMarkdown(raw).body;
  } catch (e: any) {
    warn(`[skills] 读取技能 ${entry.name} 正文失败：${e?.message || e}`);
    return '';
  }
}

/**
 * 从用户消息里解析 $技能名 引用
 *
 * 例："用 $zh-commit 帮我提交"
 *   → ['zh-commit']
 *
 * 匹配到的名字如果不在已发现的技能表里，会被忽略（不报错）——
 * 用户随手打的 $100 不能报错。
 */
export function resolveExplicitSkills(text: string, entries: SkillEntry[]): string[] {
  if (!text) return [];

  const available = new Set(entries.filter((e) => e.available).map((e) => e.name));
  if (available.size === 0) return [];

  const found: string[] = [];
  // 正则带 g 标志，必须每次新建，否则 lastIndex 会导致漏匹配
  const re = new RegExp(SKILL_REFERENCE.source, 'g');

  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const name = match[1];
    if (available.has(name) && !found.includes(name)) {
      found.push(name);
    }
  }

  return found;
}

/**
 * 为显式调用的技能造当轮注入块
 *
 * ⚠️ 这段是挂在【当轮 user 消息】上，不是 system prompt。
 *   区别很关键：
 *     · system prompt 跨轮不变 → provider 端能命中 prompt cache
 *     · 挂 user 消息 → 这一轮用完就沉到历史里，不污染长期前缀
 *   nanobot 的 context.py 也是这么区分的。
 */
export function buildExplicitSkillsBlock(names: string[], entries: SkillEntry[]): string {
  if (names.length === 0) return '';

  const byName = new Map(entries.map((e) => [e.name, e]));
  const parts: string[] = [];

  for (const name of names) {
    const entry = byName.get(name);
    if (!entry || !entry.available) continue;
    const body = readSkillBody(entry);
    if (!body) continue;
    parts.push(`### ${name}\n\n${body}`);
  }

  if (parts.length === 0) return '';

  return (
    `[本次任务启用的技能说明]\n\n` +
    `用户显式引用了这些技能，请按下面的说明执行：\n\n` +
    `${parts.join('\n\n---\n\n')}\n\n` +
    `[/本次任务启用的技能说明]`
  );
}

/** 记录一次发现结果到日志（激活时调一次，方便排障） */
export function logSkillsSummary(workspace?: string | null): void {
  const entries = listSkills(workspace);
  if (entries.length === 0) {
    info(`[skills] 未发现技能（在 ${SKILLS_DIR}/ 下扫描）`);
    return;
  }
  const always = entries.filter((e) => e.always).map((e) => e.name);
  const blocked = entries.filter((e) => !e.available).map((e) => `${e.name}(${e.unavailableReason})`);
  info(
    `[skills] 发现 ${entries.length} 个技能` +
      (always.length ? `，always: ${always.join(', ')}` : '') +
      (blocked.length ? `，不可用: ${blocked.join(', ')}` : ''),
  );
}