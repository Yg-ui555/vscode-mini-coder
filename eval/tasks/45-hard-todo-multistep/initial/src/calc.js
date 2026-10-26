/**
 * 订单金额计算
 *
 * ⚠️ 下面这份「分转元」的逻辑跟 src/format.js 里的是同一个拷贝。
 */

/** 把「分」转成「元」的字符串，例如 1250 -> "12.50" */
function yuanStr(cents) {
  const abs = Math.abs(cents);
  if (abs === 0) return '0';
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return `${yuan}.${fen < 10 ? '0' + fen : fen}`;
}

/**
 * 单价 × 数量，返回金额字符串。
 *
 * @param {number} unitCents 单价（分）
 * @param {number} count 数量
 * @returns {string} 形如 "25.00"
 */
function itemTotal(unitCents, count) {
  return yuanStr(unitCents * count);
}

module.exports = { itemTotal };
