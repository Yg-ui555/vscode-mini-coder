/**
 * MCP 参数说明（JSON Schema）归一化测试
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么这个模块值得单独测
 *
 *   它防的是【静默失败】：schema 归一化做错了不会报错，
 *   只会让模型"自己瞎猜参数"，然后传一个错的给你。
 *
 *   这种 bug 靠端到端测试很难发现，但一旦上线就是
 *   "AI 偶尔会传错参数" 这种查不出来的诡异问题。
 *
 *   所以这里逐个 case 钉死。
 *
 * 借鉴：nanobot/agent/tools/mcp.py:395-507
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeSchema,
  normalizeSchemaWithDefs,
} from '../../agent/mcp/schemaNormalize';

describe('schema 归一化 —— 基础', () => {
  it('空 schema 要兜底成空对象', () => {
    expect(normalizeSchema(undefined)).toEqual({ type: 'object', properties: {} });
    expect(normalizeSchema(null)).toEqual({ type: 'object', properties: {} });
    expect(normalizeSchema('不是对象')).toEqual({ type: 'object', properties: {} });
    expect(normalizeSchema([])).toEqual({ type: 'object', properties: {} });
  });

  it('普通的 object schema 原样保留', () => {
    const input = {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要回显的文本' },
        count: { type: 'number' },
      },
      required: ['text'],
    };
    const out = normalizeSchema(input);
    expect(out.type).toBe('object');
    expect((out.properties as any).text.type).toBe('string');
    expect((out.properties as any).text.description).toBe('要回显的文本');
    expect(out.required).toEqual(['text']);
  });
});

describe('schema 归一化 —— nullable', () => {
  it('⭐ type 是数组时要转成 nullable（这是最常见的坑）', () => {
    // MCP 服务器很爱这么写：["string", "null"]
    const input = {
      type: 'object',
      properties: {
        name: { type: ['string', 'null'] },
      },
    };
    const out = normalizeSchema(input);
    const name = (out.properties as any).name;
    expect(name.type).toBe('string');
    expect(name.nullable).toBe(true);
  });

  it('type 数组里没有 null 时不加 nullable', () => {
    const out = normalizeSchema({
      type: 'object',
      properties: { x: { type: ['string', 'number'] } },
    });
    const x = (out.properties as any).x;
    expect(x.type).toBe('string');
    expect(x.nullable).toBeUndefined();
  });
});

describe('schema 归一化 —— oneOf 降级', () => {
  it('⭐ oneOf 要降级成 anyOf（有些后端不认 oneOf）', () => {
    const input = {
      type: 'object',
      properties: {
        value: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
        },
      },
    };
    const out = normalizeSchema(input);
    const value = (out.properties as any).value;
    expect(value.oneOf).toBeUndefined();
    expect(Array.isArray(value.anyOf)).toBe(true);
    expect(value.anyOf).toHaveLength(2);
  });
});

describe('schema 归一化 —— $ref 内联', () => {
  it('⭐ $defs 里的定义要被内联展开', () => {
    const input = {
      $defs: {
        PathInput: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      type: 'object',
      properties: {
        target: { $ref: '#/$defs/PathInput' },
      },
    };
    const out = normalizeSchemaWithDefs(input);
    const target = (out.properties as any).target;
    expect(target.$ref).toBeUndefined();
    expect(target.type).toBe('object');
    expect(target.properties.path.type).toBe('string');
    expect(target.required).toEqual(['path']);
  });

  it('⭐ 自引用要断链，不能无限递归（否则栈溢出）', () => {
    const input: any = {
      $defs: {
        Node: {
          type: 'object',
          properties: { child: { $ref: '#/$defs/Node' } },
        },
      },
      type: 'object',
      properties: { root: { $ref: '#/$defs/Node' } },
    };
    // 不抛异常 = 断链成功
    const out = normalizeSchemaWithDefs(input);
    expect(out).toBeTruthy();
    const root = (out.properties as any).root;
    expect(root).toBeTruthy();
  });

  it('找不到的 $ref 要兜底，不能崩', () => {
    const input = {
      type: 'object',
      properties: { x: { $ref: '#/$defs/NotThere' } },
    };
    const out = normalizeSchemaWithDefs(input);
    const x = (out.properties as any).x;
    expect(x.type).toBe('object');
    expect(x.additionalProperties).toBe(true);
  });

  it('顶层 $defs 不用发给模型', () => {
    const input = {
      $defs: { A: { type: 'string' } },
      type: 'object',
      properties: { a: { $ref: '#/$defs/A' } },
    };
    const out = normalizeSchemaWithDefs(input);
    expect(out.$defs).toBeUndefined();
  });
});

describe('schema 归一化 —— 递归保护', () => {
  it('⭐ 循环引用的对象不能导致栈溢出', () => {
    // 直接构造一个自引用的 JS 对象（不是 $ref，是真的同一个对象）
    const node: any = { type: 'object', properties: {} };
    node.properties.self = node;

    expect(() => normalize(node)).not.toThrow();
  });

  function normalize(input: unknown): unknown {
    // 用最简单的那个入口测 —— 它有 WeakSet 保护
    return normalizeSchema(input);
  }
});
