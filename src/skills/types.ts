/**
 * 技能包（Skills）数据类型 + frontmatter 解析
 *
 * ─────────────────────────────────────────────────────────────
 * 什么是技能包，为什么要做
 * ─────────────────────────────────────────────────────────────
 *
 *   一句话：把"教 AI 做某件事"的说明，从散落在各处变成可以打包、命名、
 *   按需加载的独立文件。
 *
 *   现在项目里教 AI 的地方有三处，各有问题：
 *     · system prompt 硬编码在 context.ts —— 改一次动源码，用户改不了
 *     · AGENTS.md —— 只能有一个文件、无条件全量注入、粒度太粗
 *     · slashCommands 硬编码 —— 用户的项目有特殊需求时改不了
 *
 *   技能包解决的是"粒度 + 可分发 + 按需加载"三件事。
 *
 * ─────────────────────────────────────────────────────────────
 * 借鉴：goose 和 nanobot 用的是同一套设计，值得照抄
 * ─────────────────────────────────────────────────────────────
 *
 *   goose：crates/goose/src/slash_commands/skill_slash_command.rs
 *         读 ~/.agents/skills/ 和 .agents/skills/ 下的 SKILL.md
 *         格式 = YAML frontmatter + Markdown 正文
 *
 *   nanobot：nanobot/agent/skills.py
 *         读 <workspace>/skills/<name>/SKILL.md（外加 plugin / builtin 两级）
 *         同一个正则识别 $name 显式调用：/(?<![\w$])\$([A-Za-z0-9_-]+)/
 *
 *   两家在同一个点上想法一致，不是巧合 —— 这套设计已经被验证过。
 *
 * ─────────────────────────────────────────────────────────────
 * 核心机制：渐进式加载（progressive disclosure）
 * ─────────────────────────────────────────────────────────────
 *
 *   这是整个设计里最值钱的一条，也是本项目当前 token 压力的救星。
 *
 *   朴素做法：把 20 个技能的全部说明拼进 system prompt。
 *             假设每个 1500 字，那就是 3 万 token —— 而且【每一轮都在重发】。
 *             按 ReAct 循环跑 20 轮，光这一项就是 60 万 token。
 *
 *   渐进式：system prompt 里只放一行索引
 *             - **pdf-report** — 生成带图表的 PDF 报告  `skills/pdf-report/SKILL.md`
 *             - **db-migrate** — 数据库迁移助手    `skills/db-migrate/SKILL.md`
 *           模型觉得需要哪条，自己用 read_file 去读正文。
 *           100 个技能也只占 100 行。
 *
 *   类比：图书馆的目录卡。目录上只有书名和简介（几十行），
 *         你要看哪本书的内容，再去书架上取那本书。
 *         而不是把整个图书馆的书都搬到桌上。
 *
 *   这个思路跟本项目已做的"大输出外置"是同一个原理的两面：
 *     能外置的就别占着上下文，能按需加载的就别常驻。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 为什么不引 yaml 库
 * ─────────────────────────────────────────────────────────────
 *
 *   goose / nanobot 用真 YAML（Python 的 yaml.safe_load / serde_yaml）。
 *   本项目【刻意不引第三方依赖】，理由：
 *     · 整个项目目前是零运行时依赖，引一个 yaml 库是破例
 *     · 需要的字段只有 5 个，手写解析器完全够
 *     · YAML 是个 famously tricky 的格式，能少碰就少碰
 *
 *   代价：要诚实说明本解析器【只支持下面这个子集】，不支持嵌套对象、锚点、
 *   多行块标量等。遇到不支持的写法必须降级而不是崩。
 */

/** 技能文件的标准文件名 */
export const SKILL_FILENAME = 'SKILL.md';

/** 单个技能要求的前置条件 */
export interface SkillRequirements {
  /** 需要的可执行命令（在 PATH 里能找到） */
  bins?: string[];
  /** 需要的环境变量（要已设置） */
  env?: string[];
}

/** SKILL.md 的 frontmatter 契约（只认这些字段，其余忽略） */
export interface SkillFrontmatter {
  /** 技能名。缺失时用目录名兜底 */
  name?: string;
  /** 一句话说明。进 system prompt 索引，必须写得让模型能判断"要不要用它" */
  description?: string;
  /**
   * true = 正文全量注入 system prompt，每轮都在。
   * 适合"这个项目所有任务都要遵守"的硬规矩。
   * 默认 false（渐进式：只索引，需要时才读正文）。
   */
  always?: boolean;
  /** 前置条件。不满足时技能不可用，且在索引里标注原因 */
  requires?: SkillRequirements;
}

/** 一个已发现的技能 */
export interface SkillEntry {
  /** 技能名（目录名，或 frontmatter 里的 name） */
  name: string;
  /** 绝对路径（SKILL.md 本身） */
  absPath: string;
  /** 相对工作区的路径，用于写进 system prompt 让模型自己 read_file */
  relPath: string;
  /** 来源目录名，用于调试和去重提示 */
  source: string;
  description: string;
  always: boolean;
  requires: SkillRequirements;
  /** 前置条件是否满足 */
  available: boolean;
  /** 不可用时的原因（缺哪个 CLI / 环境变量） */
  unavailableReason?: string;
}

/**
 * 解析 SKILL.md 的 YAML frontmatter
 *
 * ⚠️ 只支持下面这个子集（不支持的一律忽略，不抛异常）：
 *
 *   ---
 *   name: pdf-report
 *   description: 生成带图表的 PDF 报告
 *   always: false
 *   requires:
 *     bins: ["python", "pandoc"]
 *     env: ["API_KEY"]
 *   ---
 *
 *   支持：key: 字符串 / 布尔 / 行内数组
 *   不支持：嵌套对象、块标量(|)、锚点(&)、多文档(---)
 *
 * @param content SKILL.md 全文
 * @returns { meta, body } — body 是剥掉 frontmatter 后的正文
 */
export function parseSkillMarkdown(
  content: string,
): { meta: SkillFrontmatter; body: string } {
  const meta: SkillFrontmatter = {};
  let body = content ?? '';

  // 必须以 --- 开头才算 frontmatter，否则整个文件当正文
  const normalized = body.replace(/^﻿/, ''); // 去掉可能存在的 BOM
  if (!/^---\s*\r?\n/.test(normalized)) {
    return { meta, body: normalized.trim() };
  }

  const endMatch = normalized.match(/\r?\n---[ \t]*(\r?\n|$)/);
  if (!endMatch || endMatch.index === undefined) {
    // 没有闭合的 frontmatter —— 当普通文本处理，别把整份 yaml 塞进 prompt
    return { meta, body: normalized.trim() };
  }

  const frontmatterText = normalized.slice(normalized.indexOf('\n') + 1, endMatch.index);
  body = normalized.slice(endMatch.index + endMatch[0].length);

  parseFrontmatterLines(frontmatterText, meta);

  return { meta, body: body.trim() };
}

/** 逐行解析 frontmatter（支持一层嵌套，用来读 requires.bins / requires.env） */
function parseFrontmatterLines(text: string, meta: SkillFrontmatter): void {
  const lines = text.split(/\r?\n/);
  let currentSection: 'requires' | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim(); // 去行尾注释
    if (!line) continue;

    // 缩进的行 = 属于上一个 section
    if (/^\s/.test(rawLine) && currentSection) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      const value = parseValue(line.slice(idx + 1));
      if (!meta.requires) meta.requires = {};
      if (key === 'bins' || key === 'env') {
        const arr = Array.isArray(value) ? value.map(String) : [String(value)];
        meta.requires[key] = arr;
      }
      continue;
    }

    const idx = line.indexOf(':');
    if (idx < 0) continue;

    const key = line.slice(0, idx).trim();
    const valueText = line.slice(idx + 1).trim();

    switch (key) {
      case 'name':
        meta.name = String(parseValue(valueText));
        currentSection = null;
        break;
      case 'description':
        meta.description = String(parseValue(valueText));
        currentSection = null;
        break;
      case 'always':
        meta.always = truthy(valueText);
        currentSection = null;
        break;
      case 'requires':
        // 只有 requires: 后面什么都没有时才进入"等待子键"状态
        if (valueText) {
          meta.requires = {};
        }
        currentSection = 'requires';
        break;
      default:
        currentSection = null;
    }
  }
}

/** 解析标量值：字符串 / 布尔 / 行内数组 */
function parseValue(text: string): string | boolean | string[] {
  const t = text.trim();
  if (!t) return '';

  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1);
    return inner
      .split(',')
      .map((s) => stripQuotes(s.trim()))
      .filter((s) => s.length > 0);
  }

  return stripQuotes(t);
}

/** 去引号 */
function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length > 1) ||
    (s.startsWith("'") && s.endsWith("'") && s.length > 1)
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/** 宽松的真值判断（YAML 1.1 风格：yes/on/true 都算真） */
function truthy(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === 'true' || t === 'yes' || t === 'on' || t === '1';
}