/**
 * 结果对象小工具。
 */

/** 成功结果 */
function success(value) {
  return { ok: true, value };
}

/** 失败结果 */
function failure(error) {
  return { ok: false, error: String(error) };
}

/** 取值，失败时给默认值 */
function unwrap(result, fallback) {
  if (!result || !result.ok) return fallback;
  return result.value;
}

module.exports = { success, failure, unwrap };
