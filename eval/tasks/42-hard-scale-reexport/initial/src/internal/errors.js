/**
 * 错误描述。
 */

/** 把任意错误转成对外可读的结构 */
function describeError(e) {
  if (!e) return { message: 'unknown error' };
  return { name: e.name || 'Error', message: String(e.message || e) };
}

module.exports = { describeError };
