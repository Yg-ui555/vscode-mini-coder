/**
 * 金额工具（按分算）。
 */

/** 格式化成 ¥12.34 */
function formatMoney(cents) {
  return '¥' + ((Number(cents) || 0) / 100).toFixed(2);
}

/** 求和 */
function sum(items) {
  let total = 0;
  for (const it of items || []) total += Number(it.amount) || 0;
  return total;
}

module.exports = { formatMoney, sum };
