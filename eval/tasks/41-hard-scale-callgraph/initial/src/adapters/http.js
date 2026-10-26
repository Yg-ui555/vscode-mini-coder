/**
 * HTTP 适配层 —— 把 job 结果包成 HTTP 响应体。
 */
const registry = require('../core/registry');

/** 执行一个 job，返回响应体 */
function handle(kind, input) {
  const result = registry.dispatch(kind, input);
  return { status: 200, body: result };
}

/** 执行失败时的错误响应 */
function fail(kind, e) {
  return { status: 500, body: { kind, error: String(e && e.message ? e.message : e) } };
}

module.exports = { handle, fail };
