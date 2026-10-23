/**
 * 技能包（Skills）测试
 *
 * 这个模块最危险的地方不是解析错，而是【悄悄不起作用】：
 *   · frontmatter 解析失败 → 技能被发现但没有 description → 模型不会选它
 *   · 渐进式索引把正文也塞进去了 → 省 token 的目的完全落空
 *   · $触发 正则误伤 → 用户打 "价格 $100" 被当成技能引用
 *   · 某个用户的 SKILL.md 写坏了 → 整个技能发现挂掉
 *
 * 所以下面的测试大量针对"静默失效"，而不只是"能不能解析出来"。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseSkillMarkdown } from '../../skills/types';
import {
  listSkills,
  buildSkillsIndex,
  buildAlwaysSkillsBlock,
  buildExplicitSkillsBlock,
  resolveExplicitSkills,
  checkRequirements,
} from '../../skills/loader';

let ws: string;

/** 在工作区里造一个技能 */
function makeSkill(name: string, frontmatter: string, body: string): void {
  const dir = path.join(ws, 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `${frontmatter}\n\n${body}\n`, 'utf-8');
}

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
});

afterEach(() => {
  try {
    fs.rmSync(ws, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

// ══════════════════════════════════════════════════════════════
describe('frontmatter 解析', () => {
  it('解析标准字段', () => {
    const { meta, body } = parseSkillMarkdown(
      `---
name: pdf-report
description: 生成带图表的 PDF 报告
always: true
---

# 正文内容
这里是真正的说明。`,
    );

    expect(meta.name).toBe('pdf-report');
    expect(meta.description).toBe('生成带图表的 PDF 报告');
    expect(meta.always).toBe(true);
    expect(body).toContain('# 正文内容');
    expect(body).not.toContain('---'); // frontmatter 被剥掉了
  });

  it('解析行内数组形式的 requires', () => {
    const { meta } = parseSkillMarkdown(`---
name: x
requires:
  bins: ["python", "pandoc"]
  env: ["API_KEY"]
---

正文`);

    expect(meta.requires?.bins).toEqual(['python', 'pandoc']);
    expect(meta.requires?.env).toEqual(['API_KEY']);
  });

  it('去掉值两侧的引号', () => {
    const { meta } = parseSkillMarkdown(`---
name: "带空格的名字"
description: '单引号也行'
---

正文`);

    expect(meta.name).toBe('带空格的名字');
    expect(meta.description).toBe('单引号也行');
  });

  it('宽松的真值判断（yes/on/1 都算真）', () => {
    for (const v of ['true', 'yes', 'on', '1']) {
      const { meta } = parseSkillMarkdown(`---
name: x
always: ${v}
---

正文`);
      expect(meta.always).toBe(true);
    }
    for (const v of ['false', 'no', 'off', '0']) {
      const { meta } = parseSkillMarkdown(`---
name: x
always: ${v}
---

正文`);
      expect(meta.always).toBe(false);
    }
  });

  // ── 健壮性：用户写的 .md 千奇百怪 ──
  it('没有 frontmatter 时整篇当正文', () => {
    const { meta, body } = parseSkillMarkdown('# 就是一个普通说明文件');
    expect(meta.name).toBeUndefined();
    expect(body).toBe('# 就是一个普通说明文件');
  });

  it('frontmatter 没闭合时不当 yaml 处理（避免把整段 yaml 塞进 prompt）', () => {
    const raw = `---\nname: 坏了\ndescription: 没闭合\n\n# 正文`;
    const { meta, body } = parseSkillMarkdown(raw);

    expect(meta.name).toBeUndefined(); // 没有被解析
    expect(body).toContain('# 正文');
  });

  it('有 BOM 也能解析（Windows 上写文件容易带 BOM）', () => {
    const { meta } = parseSkillMarkdown(`﻿---\nname: with-bom\ndescription: 测试\n---\n\n正文`);
    expect(meta.name).toBe('with-bom');
  });

  it('未知字段被忽略而不是报错', () => {
    const { meta } = parseSkillMarkdown(`---
name: x
author: 某人
version: 2
nested:
  a:
    b: 1
---

正文`);
    expect(meta.name).toBe('x');
  });

  it('行尾注释被剥离', () => {
    const { meta } = parseSkillMarkdown(`---
name: x  # 这是注释
description: 说明文字
---

正文`);
    expect(meta.name).toBe('x');
    expect(meta.description).toBe('说明文字');
  });
});

// ══════════════════════════════════════════════════════════════
describe('技能发现', () => {
  it('发现标准结构的技能', () => {
    makeSkill('alpha', `---\nname: alpha\ndescription: 甲技能\n---`, '正文甲');
    makeSkill('beta', `---\nname: beta\ndescription: 乙技能\n---`, '正文乙');

    const entries = listSkills(ws);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('目录名与 frontmatter 的 name 不一致时以 frontmatter 为准', () => {
    makeSkill('dir-name', `---\nname: real-name\ndescription: 说明\n---`, '正文');
    const entries = listSkills(ws);
    expect(entries[0].name).toBe('real-name');
  });

  it('没有 SKILL.md 的目录不算技能（静默跳过）', () => {
    fs.mkdirSync(path.join(ws, 'skills', 'empty-dir'), { recursive: true });
    makeSkill('real', `---\nname: real\ndescription: 说明\n---`, '正文');

    const entries = listSkills(ws);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('real');
  });

  it('skills/ 目录不存在时返回空数组，不抛异常', () => {
    expect(() => listSkills(path.join(ws, 'nonexistent'))).not.toThrow();
    expect(listSkills(path.join(ws, 'nonexistent'))).toEqual([]);
  });

  // ── 名字合法性 ──
  it.each(['Bad_Name', '有中文', 'has space', 'UPPER'])(
    '跳过非法技能名 %s（这些名字会污染 $触发和路径）',
    (badName) => {
      const dir = path.join(ws, 'skills', badName);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        `---\nname: ${badName}\ndescription: 说明\n---\n\n正文`,
        'utf-8',
      );

      expect(listSkills(ws)).toHaveLength(0);
    },
  );

  it('单个技能文件损坏不影响其它技能被发现', () => {
    makeSkill('good-one', `---\nname: good-one\ndescription: 好的\n---`, '正文');
    makeSkill('no-desc', `---\nname: no-desc\n---`, '正文'); // 没有 description
    makeSkill('broken', `这不是 frontmatter 格式`, '正文');

    const entries = listSkills(ws);
    const names = entries.map((e) => e.name);

    expect(names).toContain('good-one');
    // 没有 description 的仍然被发现（但会有占位说明），不该整批挂掉
    expect(names).toContain('no-desc');
  });

  it('always 技能排在前面（顺序稳定有利于 prompt cache）', () => {
    makeSkill('aaa', `---\nname: aaa\ndescription: A\n---`, 'x');
    makeSkill('zzz-always', `---\nname: zzz-always\ndescription: Z\nalways: true\n---`, 'x');

    const entries = listSkills(ws);
    expect(entries[0].name).toBe('zzz-always');
    expect(entries[0].always).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════
describe('渐进式加载（省 token 的核心）', () => {
  beforeEach(() => {
    makeSkill('big-skill', `---\nname: big-skill\ndescription: 一个说明很长的技能\n---`,
      'X'.repeat(20000));
  });

  it('索引里【只有摘要，不含正文】', () => {
    const entries = listSkills(ws);
    const index = buildSkillsIndex(entries);

    expect(index).toContain('big-skill');
    expect(index).toContain('一个说明很长的技能');
    // ⭐ 关键断言：正文一个字都不能出现在索引里
    expect(index).not.toContain('XXXXXXXX');
    // 而且必须给出路径，让模型能自己去读
    expect(index).toContain('skills/big-skill/SKILL.md');
  });

  it('索引明确告诉模型"别把 SKILL.md 都读回来"', () => {
    const index = buildSkillsIndex(listSkills(ws));
    expect(index).toContain('read_file');
    expect(index).toMatch(/不要一次性|不要凭索引猜/);
  });

  it('always: true 的技能正文【全量注入】', () => {
    const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-always-'));
    const dir = path.join(ws2, 'skills', 'hard-rule');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\nname: hard-rule\ndescription: 项目硬规矩\nalways: true\n---\n\n所有提交信息必须中文。`,
      'utf-8',
    );

    const block = buildAlwaysSkillsBlock(listSkills(ws2));
    expect(block).toContain('所有提交信息必须中文');
    expect(block).toContain('hard-rule');

    fs.rmSync(ws2, { recursive: true, force: true });
  });

  it('always 技能不出现在渐进式索引里（内容已经全给了，再列一次是浪费）', () => {
    const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-idx-'));
    const dir = path.join(ws2, 'skills', 'always-one');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\nname: always-one\ndescription: 硬规矩\nalways: true\n---\n\n正文ABC`,
      'utf-8',
    );

    const entries = listSkills(ws2);
    const index = buildSkillsIndex(entries.filter((e) => !e.always));
    expect(index).not.toContain('always-one');

    fs.rmSync(ws2, { recursive: true, force: true });
  });

  it('没有技能时索引为空串', () => {
    expect(buildSkillsIndex([])).toBe('');
    expect(buildAlwaysSkillsBlock([])).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════
describe('$技能名 显式触发', () => {
  beforeEach(() => {
    makeSkill('zh-commit', `---\nname: zh-commit\ndescription: 中文提交\n---`, '# 中文提交\n用中文写。');
    makeSkill('debug', `---\nname: debug\ndescription: 调试\n---`, '# 调试流程');
  });

  it('识别出显式引用的技能', () => {
    const entries = listSkills(ws);
    expect(resolveExplicitSkills('用 $zh-commit 帮我提交', entries)).toEqual(['zh-commit']);
  });

  it('一次引用多个', () => {
    const entries = listSkills(ws);
    expect(resolveExplicitSkills('$zh-commit 和 $debug 都用上', entries).sort()).toEqual([
      'debug',
      'zh-commit',
    ]);
  });

  // ── 误伤是这里最大的风险 ──
  it.each([
    ['这个价格只要 $100', '不该把金额当成技能'],
    ['变量名 cost$USD 是这样写的', '不该把变量名当成技能'],
    ['没有引用', '纯文本不该有输出'],
  ])('不误伤：%s', (text) => {
    const entries = listSkills(ws);
    const got = resolveExplicitSkills(text, entries);
    // 只要不是恰好命中真实技能名就行
    expect(got.filter((n) => ['zh-commit', 'debug'].includes(n))).toHaveLength(0);
  });

  it('引用了不存在的技能时静默忽略，不报错', () => {
    const entries = listSkills(ws);
    expect(() => resolveExplicitSkills('$不存在的技能', entries)).not.toThrow();
    expect(resolveExplicitSkills('$不存在的技能', entries)).toEqual([]);
  });

  it('重复引用同一个技能只返回一次', () => {
    const entries = listSkills(ws);
    expect(resolveExplicitSkills('$debug $debug $debug', entries)).toEqual(['debug']);
  });

  it('显式注入块包含正文', () => {
    const entries = listSkills(ws);
    const block = buildExplicitSkillsBlock(['zh-commit'], entries);
    expect(block).toContain('用中文写');
    expect(block).toContain('本次任务启用的技能');
  });

  it('注入块里不包含 frontmatter（那部分只在索引里有意义）', () => {
    const entries = listSkills(ws);
    const block = buildExplicitSkillsBlock(['zh-commit'], entries);
    expect(block).not.toContain('description: 中文提交');
  });
});

// ══════════════════════════════════════════════════════════════
describe('前置条件门控', () => {
  it('bins 全部存在时通过', () => {
    // node 在任何环境下都存在
    expect(checkRequirements({ bins: ['node'] })).toBeUndefined();
  });

  it('bins 缺失时给出可读原因', () => {
    const reason = checkRequirements({ bins: ['definitely-not-a-real-binary-xyz123'] });
    expect(reason).toContain('CLI:');
    expect(reason).toContain('definitely-not-a-real-binary-xyz123');
  });

  it('env 缺失时给出可读原因', () => {
    const reason = checkRequirements({ env: ['MINI_CODER_FAKE_ENV_XYZ'] });
    expect(reason).toContain('ENV:');
  });

  it('env 已设置时通过', () => {
    process.env.MINI_CODER_TEST_ENV = '1';
    expect(checkRequirements({ env: ['MINI_CODER_TEST_ENV'] })).toBeUndefined();
    delete process.env.MINI_CODER_TEST_ENV;
  });

  it('空环境变量不算已设置', () => {
    process.env.MINI_CODER_TEST_EMPTY = '';
    expect(checkRequirements({ env: ['MINI_CODER_TEST_EMPTY'] })).toContain('ENV:');
    delete process.env.MINI_CODER_TEST_EMPTY;
  });

  it('缺依赖的技能被标记为不可用，且索引里说明原因', () => {
    makeSkill('needs-ghost', `---\nname: needs-ghost\ndescription: 需要不存在的东西\nrequires:\n  bins: ["ghost-binary-xyz999"]\n---`, '正文');

    const entries = listSkills(ws);
    const ghost = entries.find((e) => e.name === 'needs-ghost')!;

    expect(ghost.available).toBe(false);
    expect(ghost.unavailableReason).toContain('ghost-binary-xyz999');

    // 索引里要标出来，免得模型去调一个必然失败的东西
    const index = buildSkillsIndex(entries);
    expect(index).toContain('needs-ghost');
    expect(index).toContain('不可用');
  });

  it('不可用的技能不能被 $触发', () => {
    makeSkill('blocked', `---\nname: blocked\ndescription: 被禁用\nrequires:\n  bins: ["ghost-binary-xyz999"]\n---`, '正文');

    const entries = listSkills(ws);
    expect(resolveExplicitSkills('$blocked', entries)).toEqual([]);
  });
});