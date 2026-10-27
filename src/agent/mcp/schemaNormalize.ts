/**
 * MCP 参数说明（JSON Schema）→ OpenAI 兼容格式 的归一化
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐⭐ 为什么必须有这个模块（nanobot 花了几百行踩坑总结出来的）
 *
 *   MCP 传的是【完整 JSON Schema】—— 能带 $ref / $defs / oneOf / anyOf。
 *   但很多 OpenAI 兼容后端（DeepSeek / MiniMax / 一些自建网关）
 *   【只认扁平的】。
 *
 *   后果不是"调用失败"这么简单 —— 是模型看到一份后端不认的说明书，
 *   【自己瞎猜参数】，然后传一个错的给你。
 *   轻则报错，重则执行了错误的东西（比如把 path 猜成别的目录）。
 *
 *   比喻：给司机一份只写了"去那个地方"的地图。
 *   他不会停下来问，他会【自己选一条路开过去】。
 *
 * ─────────────────────────────────────────────────────────────
 * 我们处理 5 类
 *
 *   1. $ref 引用         → 内联展开成具体结构
 *   2. type 是数组       → ["string","null"] 转成 type:"string" + nullable:true
 *   3. oneOf             → 降级成 anyOf（some 后端不认 oneOf，但认 anyOf）
 *   4. 自引用           → 断链，防止无限展开
 *   5. 顶层不是对象      → 兜底成 { type: 'object', properties: {} }
 *
 * ─────────────────────────────────────────────────────────────
 * 借鉴来源
 *
 *   nanobot/agent/tools/mcp.py:395-507
 *     _rewrite_local_schema_refs   —— $ref 内联
 *     _normalize_nullable_schema   —— type 数组转 nullable
 *     _normalize_schema_for_openai —— 总入口
 *
 *   它为什么需要递归保护（:434-435）：
 *     MCP 的 schema 可以自引用（$defs 里又引用 $defs），
 *     不保护就会无限递归 → 栈溢出 → 服务器崩。
 */

/**
 * 归一化入口
 *
 * @param schema MCP 传过来的 inputSchema
 * @returns OpenAI 兼容的 function parameters
 */
export function normalizeSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    // MCP 规范要求 inputSchema 是对象；不是的话给个最保守的空壳
    return { type: 'object', properties: {} };
  }

  // ⭐ 用 WeakSet 记住"正在处理中"的对象，识别自引用。
  //   WeakSet 不会阻止垃圾回收，也不会无限增长。
  const seen = new WeakSet<object>();
  return walk(schema, seen) as Record<string, unknown>;
}

/**
 * 递归处理单个节点
 */
function walk(node: unknown, seen: WeakSet<object>): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((n) => walk(n, seen));

  const src = node as Record<string, unknown>;

  // ── 自引用保护 ──────────────────────────────────────────
  // A 的属性引用 A 自己（或者 A→B→A）。
  // 不拦住的话会无限递归，栈溢出把进程带走。
  if (seen.has(src)) {
    return {
      type: 'object',
      description: '（递归引用，已截断）',
    };
  }
  seen.add(src);

  // ── $ref 内联展开 ───────────────────────────────────────
  // MCP 常见写法：{ "$ref": "#/$defs/PathInput" }
  // $defs 在同一份 schema 的顶层，我们在这里拿不到上下文，
  // 所以真正的内联需要在【入口】把 $defs 传进来。
  // 入口做了（见 normalizeSchemaWithDefs）；这里做兜底。
  if (typeof src.$ref === 'string') {
    return {
      type: 'object',
      description:
        typeof src.description === 'string'
          ? src.description
          : '（参数结构由 MCP 服务器定义）',
      additionalProperties: true,
    };
  }

  const out: Record<string, unknown> = { ...src };

  // ── type 是数组 → nullable ───────────────────────────────
  // { "type": ["string", "null"] } → { "type": "string", "nullable": true }
  if (Array.isArray(src.type)) {
    const types = (src.type as unknown[]).filter(
      (t): t is string => typeof t === 'string' && t !== 'null',
    );
    out.type = types[0] ?? 'string';
    if (types.length !== (src.type as unknown[]).length) {
      out.nullable = true;
    }
  }

  // ── oneOf 降级成 anyOf ──────────────────────────────────
  // 语义上 anyOf 更宽松（"满足其中之一"），是安全降级：
  // 宁可让模型多试几个形状，也不要因为后端不认 oneOf 直接调用失败。
  if (Array.isArray(src.oneOf)) {
    out.anyOf = (src.oneOf as unknown[]).map((s) => walk(s, seen));
    delete out.oneOf;
  }
  if (Array.isArray(src.anyOf)) {
    out.anyOf = (src.anyOf as unknown[]).map((s) => walk(s, seen));
  }

  // ── 递归处理子节点 ───────────────────────────────────────
  if (src.properties && typeof src.properties === 'object' && !Array.isArray(src.properties)) {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(src.properties as Record<string, unknown>)) {
      props[key] = walk(val, seen);
    }
    out.properties = props;
  }

  if (src.items !== undefined) {
    out.items = walk(src.items, seen);
  }

  if (src.additionalProperties && typeof src.additionalProperties === 'object') {
    out.additionalProperties = walk(src.additionalProperties, seen);
  }

  // required 是字符串数组，原样保留（不递归）
  if (Array.isArray(src.required)) {
    out.required = src.required;
  }

  return out;
}

/**
 * ⭐ 带 $defs 的归一化入口（真正的 $ref 内联在这里做）
 *
 * MCP 的 schema 形如：
 *   {
 *     "$defs": { "PathInput": { "type": "object", "properties": {...} } },
 *     "type": "object",
 *     "properties": { "path": { "$ref": "#/$defs/PathInput" } }
 *   }
 *
 * 我们的做法：先把 $defs 收集出来，递归时遇到 $ref 就去查表。
 *
 * @param schema MCP 的 inputSchema
 */
export function normalizeSchemaWithDefs(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {} };
  }

  const src = schema as Record<string, unknown>;
  const defs =
    src.$defs && typeof src.$defs === 'object' && !Array.isArray(src.$defs)
      ? (src.$defs as Record<string, unknown>)
      : {};

  const seen = new WeakSet<object>();
  const resolving = new Set<string>(); // 正在展开的 $ref 名，防环

  const walkWithDefs = (node: unknown): unknown => {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(walkWithDefs);

    const s = node as Record<string, unknown>;

    if (typeof s.$ref === 'string') {
      // "#/$defs/Foo" → "Foo"
      const name = s.$ref.replace(/^#\/\$defs\//, '');

      // ⭐ 环检测：正在展开的 ref 再次出现 → 截断
      if (resolving.has(name)) {
        return { type: 'object', description: `（递归引用 ${name}，已截断）` };
      }
      const target = defs[name];
      if (target === undefined) {
        // 找不到定义 → 保守兜底
        return {
          type: 'object',
          description: `（参数结构由 MCP 服务器定义：${name}）`,
          additionalProperties: true,
        };
      }

      resolving.add(name);
      const expanded = walkWithDefs(target);
      resolving.delete(name);

      // 合并 $ref 旁边的其它字段（比如 description）
      const merged =
        expanded && typeof expanded === 'object' && !Array.isArray(expanded)
          ? { ...(expanded as Record<string, unknown>), ...s }
          : expanded;
      if (merged && typeof merged === 'object' && !Array.isArray(merged)) {
        delete (merged as Record<string, unknown>).$ref;
      }
      return merged;
    }

    if (seen.has(s)) {
      return { type: 'object', description: '（递归引用，已截断）' };
    }
    seen.add(s);

    const out: Record<string, unknown> = { ...s };

    if (Array.isArray(s.type)) {
      const types = (s.type as unknown[]).filter(
        (t): t is string => typeof t === 'string' && t !== 'null',
      );
      out.type = types[0] ?? 'string';
      if (types.length !== (s.type as unknown[]).length) {
        out.nullable = true;
      }
    }

    if (Array.isArray(s.oneOf)) {
      out.anyOf = (s.oneOf as unknown[]).map(walkWithDefs);
      delete out.oneOf;
    }
    if (Array.isArray(s.anyOf)) {
      out.anyOf = (s.anyOf as unknown[]).map(walkWithDefs);
    }

    if (s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties)) {
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(s.properties as Record<string, unknown>)) {
        props[k] = walkWithDefs(v);
      }
      out.properties = props;
    }
    if (s.items !== undefined) out.items = walkWithDefs(s.items);
    if (Array.isArray(s.required)) out.required = s.required;

    return out;
  };

  const result = walkWithDefs(src);
  // 顶层 $defs 不用发给模型 —— 它只是"定义的容器"
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    delete (result as Record<string, unknown>).$defs;
  }
  return result as Record<string, unknown>;
}
