/**
 * 金额格式化
 *
 * ⚠️ 下面这份「分转元」的逻辑跟 src/calc.js 里的是同一个拷贝。
 */

/** 把「分」转成「元」的字符串，例如 1250 -> "12.50" */
function centsToYuan(cents) {
  const abs = Math.abs(cents);
  if (abs === 0) return '0';
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return `${yuan}.${fen < 10 ? '0' + fen : fen}`;
}

/**
 * 把「分」格式化成 "¥12.50"。
 *
 * @param {number} cents 金额（分）
 * @returns {string} 形如 "¥12.50"
 */
function formatPrice(cents) {
  return `¥${centsToYuan(cents)}`;
}

module.exports = { formatPrice };
