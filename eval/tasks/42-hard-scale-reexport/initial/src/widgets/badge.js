/**
 * 徽标 —— 宽度有限，超出走内部层的截断。
 */
const { truncate } = require('../internal/http');

/** 渲染徽标 */
function badge(text) {
  return '[' + truncate(text, 12) + ']';
}

module.exports = { badge };
