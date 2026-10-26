/**
 * 断言。
 */

/** 断言条件成立 */
function ok(cond, message) {
  if (!cond) throw new Error(message || '断言失败');
}

module.exports = { ok };
