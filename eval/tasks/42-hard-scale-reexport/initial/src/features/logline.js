/**
 * 日志摘要行 —— 日志中心用。
 */
const { legacyTruncate } = require('../core/legacy');

/** 生成一行日志摘要 */
function logline(text) {
  return legacyTruncate(text, 60);
}

module.exports = { logline };
