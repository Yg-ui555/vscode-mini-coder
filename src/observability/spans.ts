/**
 * 轻量调用追踪 —— 对齐 OpenTelemetry GenAI 语义约定
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 为什么不引完整的 OTel SDK
 *
 *   完整的 SDK 会带来几十 MB 的依赖、一套概念、一堆配置 ——
 *   而本项目需要的只是"记下每次调用花了多少、卡在哪"。
 *
 *   所以这里做【约 150 行】的轻量实现：
 *   字段名严格对齐 OTel GenAI 语义约定（以后接任何 APM 都不用重命名），
 *   但没有 exporter、没有 sampler、没有 context propagation。
 *
 * ─────────────────────────────────────────────────────────────
 * 字段名为什么这么写
 *
 *   gen_ai.* 是 OTel 社区定的【GenAI 语义约定】，
 *   业界（Langfuse / Arize / Phoenix / 各家 APM）都认这套名字。
 *   用它 = 未来接 APM 时零改造成本。
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐⭐ 一个必须做的安全设计：prompt 内容默认不进 trace
 *
 *   借鉴 goose 的 gen_ai_telemetry.rs:9-14
 *   （CAPTURE_MESSAGE_CONTENT_ENV 环境变量，默认关闭）。
 *
 *   比喻：行车记录仪默认只录"车往哪开、多快、什么时候刹车"，
 *   【不录乘客的脸】。
 *
 *   你的 agent 会读到用户源码、密码、API Key ——
 *   默认把 prompt 原文写进日志文件，等于把用户代码抄了一份到磁盘上。
 *   要开必须显式设环境变量。
 */

export interface Span {
  id: string;
  parentId?: string;
  /** span 名字，如 "gen_ai.chat" / "gen_ai.tool" */
  name: string;
  startTime: number;
  durationMs?: number;
  attributes: Record<string, string | number | boolean>;
  error?: string;
}

/**
 * ⭐ 记录 prompt 内容的开关
 *
 * 默认关闭。要开就设环境变量 MINI_CODER_TRACE_CONTENT=1。
 */
export const TRACE_CONTENT_ENV = 'MINI_CODER_TRACE_CONTENT';

export function traceContentEnabled(): boolean {
  return process.env[TRACE_CONTENT_ENV] === '1';
}

export class SpanRecorder {
  private spans: Span[] = [];
  /** 当前打开的 span 栈（用来自动建立父子关系） */
  private stack: string[] = [];
  private seq = 0;

  /**
   * 开一个 span
   *
   * @param name  span 名字
   * @param attributes  属性（用 OTel GenAI 约定的字段名）
   * @returns span id（结束时要传回来）
   */
  start(name: string, attributes: Span['attributes'] = {}): string {
    const id = `s${(++this.seq).toString(36)}`;
    this.spans.push({
      id,
      parentId: this.stack[this.stack.length - 1],
      name,
      startTime: Date.now(),
      attributes,
    });
    this.stack.push(id);
    return id;
  }

  /** 结束一个 span */
  end(id: string, extra?: { durationMs?: number; error?: string; attributes?: Span['attributes'] }): void {
    const span = this.spans.find((s) => s.id === id);
    if (!span) return;

    // 找到它在栈里的位置并弹出（以及它上面的所有 span）
    const idx = this.stack.lastIndexOf(id);
    if (idx >= 0) this.stack.length = idx;

    span.durationMs = extra?.durationMs ?? Date.now() - span.startTime;
    if (extra?.error) span.error = extra.error;
    if (extra?.attributes) Object.assign(span.attributes, extra.attributes);
  }

  /** 全部 span（按开始时间排） */
  getAll(): Span[] {
    return [...this.spans].sort((a, b) => a.startTime - b.startTime);
  }

  clear(): void {
    this.spans = [];
    this.stack = [];
  }

  /** 汇总统计 */
  summary(): { total: number; errors: number; totalDurationMs: number } {
    const all = this.getAll();
    return {
      total: all.length,
      errors: all.filter((s) => s.error).length,
      totalDurationMs: all.reduce((n, s) => n + (s.durationMs ?? 0), 0),
    };
  }

  /**
   * 渲染成调用链树（给人看的）
   *
   * 例：
   *   gen_ai.chat  model=deepseek-chat  in=12345 out=678  1.2s
   *     └ gen_ai.tool  read_file  0.03s
   *     └ gen_ai.tool  grep  0.15s
   */
  renderTree(): string {
    const all = this.getAll();
    if (all.length === 0) return '（本次会话还没有追踪记录）';

    const byId = new Map(all.map((s) => [s.id, s]));
    const children = new Map<string | undefined, Span[]>();
    for (const s of all) {
      const list = children.get(s.parentId) ?? [];
      list.push(s);
      children.set(s.parentId, list);
    }

    const lines: string[] = [];
    const walk = (parentId: string | undefined, depth: number) => {
      for (const s of children.get(parentId) ?? []) {
        const indent = depth === 0 ? '' : '  '.repeat(depth) + '└ ';
        const attrs = Object.entries(s.attributes)
          .map(([k, v]) => `${k}=${v}`)
          .join('  ');
        const dur = s.durationMs !== undefined ? `${s.durationMs}ms` : '…';
        lines.push(`${indent}${s.name}  [${dur}]${attrs ? '  ' + attrs : ''}`);
        if (s.error) lines.push(`${indent}  ⚠ 错误：${s.error}`);
        walk(s.id, depth + 1);
      }
    };
    walk(undefined, 0);

    const st = this.summary();
    lines.push('');
    lines.push(`共 ${st.total} 个 span，耗时合计 ${st.totalDurationMs}ms，错误 ${st.errors} 个`);
    return lines.join('\n');
  }
}

/** 全局单例 */
const recorder = new SpanRecorder();

export function getSpanRecorder(): SpanRecorder {
  return recorder;
}

/** 便捷函数：包一段同步逻辑 */
export function withSpan<T>(
  name: string,
  attributes: Span['attributes'],
  fn: (spanId: string) => T,
): T {
  const rec = getSpanRecorder();
  const id = rec.start(name, attributes);
  try {
    const r = fn(id);
    rec.end(id);
    return r;
  } catch (e: any) {
    rec.end(id, { error: e?.message || String(e) });
    throw e;
  }
}
