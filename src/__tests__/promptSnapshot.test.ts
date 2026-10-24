/**
 * Prompt 快照测试（2026-10-24）
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么 agent 项目需要这个
 * ─────────────────────────────────────────────────────────────
 *
 *   改 prompt 是 agent 开发里最常见的操作，也是最容易悄悄搞坏东西的操作。
 *
 *   典型翻车现场：
 *     你改了 system prompt 里的一句话 → 某道题的 pass rate 从 ✅ 变 ❌
 *     → 但你同时也改了别的东西 → 根本不知道是哪句话的锅
 *     → 于是去调工具、换模型 → 全在错误方向使劲
 *
 *   这跟本项目 README 里写的「测量工具的 bug 比被测对象更可怕」是同一个病。
 *
 *   快照测试把 prompt 变成【代码】：
 *     改了就必须承认改了（git diff 里一眼能看到提示词变了多少）。
 *
 *   借鉴来源：goose 的 prompt_manager.rs:424/440/461/525
 *     用 insta 断言系统提示词全文，本项目用 vitest 的 toMatchSnapshot()。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 但光有裸快照是不够的
 * ─────────────────────────────────────────────────────────────
 *
 *   快照只能告诉你"变了"，不能告诉你"变坏了"。
 *   所以下面额外加了 3 条【有实际约束力的硬断言】：
 *     1. prompt 里必须包含工具限制说明（缺了 → agent 不知道自己的边界）
 *     2. prompt 里绝不能出现 API Key（泄密 —— 一旦发生是安全事故）
 *     3. prompt 长度必须在预算内（超了 → 说明有东西该外置却没外置）
 *
 *   这三条断言是【不依赖快照文件】的独立防线，
 *   哪怕有人删掉快照重新生成，这三条依然拦得住。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ContextBuilder } from '../agent/context';

/** 临时工作区，用来放 AGENTS.md / skills/ 做可控的 prompt 组合 */
let tmp: string;

/**
 * ⭐ 快照前必须归一化路径
 *
 *   为什么：
 *     prompt 里包含工作区的绝对路径（`工作目录：D:\xxx\xxx`）。
 *     临时目录每次跑都不一样 → 快照永远不匹配 → 测试变成噪音。
 *
 *   这不是"把断言改松"，而是把【不稳定的部分】从快照里剔除：
 *     · 路径 → 固定占位符
 *     · 真正要盯的（prompt 的结构、文字、顺序）保持一字不差
 *
 *   类比：给照片打水印时会遮掉拍摄时间，
 *   因为那是变量不是特征 —— 但画面内容一寸不遮。
 */
function normalize(prompt: string): string {
  return prompt
    .split(tmp)
    .join('<WORKSPACE>')
    .replace(/[A-Za-z]:\\[^\s`"']+/g, '<PATH>');
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minicoder-prompt-'));
});

afterAll(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* 清理失败不致命 */
  }
});

describe('system prompt 快照', () => {
  it('基础 prompt（无 bootstrap / 无 skills）不应随意变化', () => {
    const prompt = new ContextBuilder(null, null).buildSystemPrompt();
    expect(normalize(prompt)).toMatchSnapshot();
  });

  it('有项目规则文件时的 prompt', () => {
    const ws = path.join(tmp, 'with-bootstrap');
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(
      path.join(ws, 'AGENTS.md'),
      '# 项目规则\n\n- 所有提交信息必须中文\n- 禁止直接改 src/legacy 目录\n',
      'utf-8',
    );
    const prompt = new ContextBuilder(ws, null).buildSystemPrompt();
    expect(normalize(prompt)).toMatchSnapshot();
  });

  it('有技能包时的 prompt（索引模式）', () => {
    const ws = path.join(tmp, 'with-skills');
    const skillDir = path.join(ws, 'skills', 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      ['---', 'name: my-skill', 'description: 测试用技能', '---', '', '技能正文内容。'].join('\n'),
      'utf-8',
    );
    const prompt = new ContextBuilder(ws, null).buildSystemPrompt();
    expect(normalize(prompt)).toMatchSnapshot();
  });
});

describe('⭐ prompt 硬断言（不依赖快照，独立防线）', () => {
  it('必须包含工具限制说明 —— 缺了 agent 就不知道自己的边界', () => {
    const prompt = new ContextBuilder(null, null).buildSystemPrompt();
    expect(prompt).toContain('工具限制');
  });

  it('绝不能出现 API Key —— 泄密是安全事故', () => {
    const prompt = new ContextBuilder(null, null).buildSystemPrompt();

    // 常见 key 格式：sk-xxx / sk-ant-xxx / gsk_xxx
    expect(prompt).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
    expect(prompt).not.toMatch(/sk-ant-[A-Za-z0-9_-]{16,}/);
    expect(prompt).not.toMatch(/gsk_[A-Za-z0-9]{16,}/);

    // 通用形态：key=xxx / api_key: xxx
    expect(prompt).not.toMatch(/(api[_-]?key|secret|token)\s*[:=]\s*[A-Za-z0-9_-]{16,}/i);
  });

  it('长度必须在预算内 —— 超了说明有东西该外置却没外置', () => {
    const prompt = new ContextBuilder(null, null).buildSystemPrompt();

    // 20000 字符 ≈ 8000 token（按 3.6 字符/token 的保守估算）
    // 超了就是 prompt 膨胀，属于回归
    expect(prompt.length).toBeLessThan(20_000);
  });

  it('必须包含中文 commit 规范（项目特色之一，删了就是功能回退）', () => {
    const prompt = new ContextBuilder(null, null).buildSystemPrompt();
    expect(prompt).toContain('中文 commit 规范');
    expect(prompt).toContain('功能:');
  });

  it('必须告知错题本的存在（否则 agent 不会调用 record_note）', () => {
    const prompt = new ContextBuilder(null, null).buildSystemPrompt();
    expect(prompt).toContain('record_note');
  });
});
