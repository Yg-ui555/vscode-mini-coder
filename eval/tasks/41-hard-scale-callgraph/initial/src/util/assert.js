/**
 * 断言工具 —— 出错时把两边都打出来，省得调半天。
 */

/** 断言条件成立 */
function ok(cond, message) {
  if (!cond) throw new Error(message || '断言失败');
}

/** 断言两个值相等 */
function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      (message || '值不相等') + '：实际=' + JSON.stringify(actual) + ' 期望=' + JSON.stringify(expected),
    );
  }
}

/** 断言是函数 */
function fn(value, message) {
  ok(typeof value === 'function', message || '期望是函数，实际是 ' + typeof value);
}

module.exports = { ok, equal, fn };
