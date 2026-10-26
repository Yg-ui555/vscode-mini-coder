/**
 * 调用上下文 —— 跟着一次执行走的东西（trace id、租户、用户）。
 *
 * ⚠️ 用 AsyncLocalStorage 的话在 CommonJS 里比较绕，
 *    这里用最简单的"显式传参 + 浅拷贝"，
 *    好处是行为完全可预测，评测里对拍不会莫名其妙不一致。
 */

/** 造一个空上下文 */
function create(fields) {
  return Object.assign({ traceId: '', tenant: '', user: '' }, fields || {});
}

/** 派生一个子上下文（不改原来的） */
function derive(ctx, patch) {
  return Object.assign({}, ctx, patch || {});
}

/** 读一个字段，缺失时给默认值 */
function pick(ctx, key, fallback) {
  if (!ctx || ctx[key] === undefined) return fallback;
  return ctx[key];
}

/** 生成一个 trace id */
function newTraceId(seed) {
  const s = seed === undefined ? Date.now() : seed;
  return 'trace-' + s.toString(36);
}

module.exports = { create, derive, pick, newTraceId };
