/**
 * 金额工具 —— 全部按【分】算，避免浮点误差。
 */

/** 元转分 */
function toCents(yuan) {
  return Math.round(Number(yuan) * 100) || 0;
}

/** 分转元 */
function toYuan(cents) {
  return (Number(cents) || 0) / 100;
}

/** 格式化成两位小数的字符串 */
function format(cents) {
  return (Number(cents) || 0).toFixed(2);
}

/** 相加 */
function add(a, b) {
  return (Number(a) || 0) + (Number(b) || 0);
}

module.exports = { toCents, toYuan, format, add };
