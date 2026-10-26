/**
 * 调用链追踪（OpenTelemetry 风格）测试
 *
 * ⭐ 这个模块测的是"可观测性"本身，不是业务逻辑：
 *   · span 的父子关系对不对（不然调用链树就是平的，看不出层级）
 *   · 统计对不对（token 账单 / 耗时 / 错误数）
 *   · ⭐ prompt 内容默认【不进】trace（安全默认值）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SpanRecorder,
  getSpanRecorder,
  traceContentEnabled,
  TRACE_CONTENT_ENV,
} from '../observability/spans';
import { renderTracesReport } from '../commands/traces';

describe('SpanRecorder', () => {
  let rec: SpanRecorder;

  beforeEach(() => {
    rec = new SpanRecorder();
  });

  it('start/end 记录一条 span', () => {
    const id = rec.start('gen_ai.chat', { 'gen_ai.request.model': 'deepseek-chat' });
    rec.end(id, { durationMs: 123 });

    const all = rec.getAll();
    expect(all.length).toBe(1);
    expect(all[0].name).toBe('gen_ai.chat');
    expect(all[0].durationMs).toBe(123);
    expect(all[0].attributes['gen_ai.request.model']).toBe('deepseek-chat');
  });

  it('⭐ 嵌套 span 自动建立父子关系', () => {
    const chat = rec.start('gen_ai.chat');
    const tool = rec.start('gen_ai.tool');
    rec.end(tool);
    rec.end(chat);

    const all = rec.getAll();
    expect(all.find((s) => s.name === 'gen_ai.tool')!.parentId).toBe(chat);
    expect(all.find((s) => s.name === 'gen_ai.chat')!.parentId).toBeUndefined();
  });

  it('summary 统计总数 / 错误数 / 耗时', () => {
    const a = rec.start('gen_ai.chat');
    const b = rec.start('gen_ai.tool');
    rec.end(a, { durationMs: 100 });
    rec.end(b, { durationMs: 50, error: 'boom' });

    const st = rec.summary();
    expect(st.total).toBe(2);
    expect(st.errors).toBe(1);
    expect(st.totalDurationMs).toBe(150);
  });

  it('renderTree 渲染出层级（子节点缩进 + └ 前缀）', () => {
    const chat = rec.start('gen_ai.chat', { 'gen_ai.request.model': 'deepseek-chat' });
    const tool = rec.start('gen_ai.tool', { 'gen_ai.tool.name': 'read_file' });
    rec.end(tool, { durationMs: 10 });
    rec.end(chat, { durationMs: 100 });

    const tree = rec.renderTree();
    expect(tree).toContain('gen_ai.chat');
    expect(tree).toContain('└ gen_ai.tool');
    expect(tree).toContain('gen_ai.tool.name=read_file');
  });

  it('clear 之后什么都不剩', () => {
    rec.start('gen_ai.chat');
    rec.clear();
    expect(rec.getAll().length).toBe(0);
    expect(rec.renderTree()).toContain('还没有追踪记录');
  });
});

describe('trace 内容开关', () => {
  const old = process.env[TRACE_CONTENT_ENV];

  afterEach(() => {
    if (old === undefined) delete process.env[TRACE_CONTENT_ENV];
    else process.env[TRACE_CONTENT_ENV] = old;
  });

  it('⭐ 默认【不】记录 prompt 内容', () => {
    delete process.env[TRACE_CONTENT_ENV];
    expect(traceContentEnabled()).toBe(false);
  });

  it('显式设成 1 才开启', () => {
    process.env[TRACE_CONTENT_ENV] = '1';
    expect(traceContentEnabled()).toBe(true);
  });

  it('设成别的值（比如 0 / true / yes）都不开启', () => {
    // 必须是"精确等于 1"才开 —— 免得有人写 true 就意外把源码写进日志。
    for (const v of ['0', 'true', 'yes', '']) {
      process.env[TRACE_CONTENT_ENV] = v;
      expect(traceContentEnabled()).toBe(false);
    }
  });
});

describe('/traces 报告渲染', () => {
  beforeEach(() => {
    getSpanRecorder().clear();
  });

  it('没有记录时给出明确提示（而不是空白）', () => {
    const out = renderTracesReport();
    expect(out).toContain('还没有追踪记录');
  });

  it('有记录时给出调用链 + 用量 + 最慢工具', () => {
    const rec = getSpanRecorder();
    const chat = rec.start('gen_ai.chat', { 'gen_ai.request.model': 'deepseek-chat' });
    const tool = rec.start('gen_ai.tool', { 'gen_ai.tool.name': 'read_file' });
    rec.end(tool, { durationMs: 42 });
    rec.end(chat, { durationMs: 800 });
    // 补上 usage（真实运行时是 provider 写的）
    const span = rec.getAll().find((s) => s.name === 'gen_ai.chat')!;
    span.attributes['gen_ai.usage.input_tokens'] = 12345;
    span.attributes['gen_ai.usage.output_tokens'] = 678;

    const out = renderTracesReport();
    expect(out).toContain('gen_ai.chat');
    expect(out).toContain('deepseek-chat');
    expect(out).toContain('12,345'); // token 加了千分位
    expect(out).toContain('read_file');
    expect(out).toContain('最慢的 3 个工具');
  });
});
