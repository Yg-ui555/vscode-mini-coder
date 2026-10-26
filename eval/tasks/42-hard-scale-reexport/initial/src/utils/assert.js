/**
 * 断言。
 */

/** 断言条件成立 */
function ok(cond, message) {
  if (!cond) throw new Error(message || '断言失败');
}

/** 断言值相等 */
function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || '值不相等') + '：实际=' + JSON.stringify(actual) + ' 期望=' + JSON.stringify(expected));
  }
}

module.exports = { ok, equal };
