/**
 * 账单明细行。
 */

/** 造一行明细 */
function lineItem(name, amount, qty) {
  return { name: String(name || ''), amount: Math.round(amount) || 0, qty: Math.max(1, Number(qty) || 1) };
}

/** 明细行合计 */
function sumLines(lines) {
  let total = 0;
  for (const l of lines || []) total += l.amount * l.qty;
  return total;
}

module.exports = { lineItem, sumLines };
