/**
 * 金额格式化 —— 新旧两套实现并存，迁移中。
 *
 * legacyFormat 是老实现：先转字符串再补零，负数会多出一个减号位。
 * formatMoney 是新实现：直接用 toFixed(2)。
 * 两者的输出在【正数】上逐字相同，所以迁移是一个纯重构。
 */

/** 老实现 —— 本次任务要把它从所有调用点迁走 */
function legacyFormat(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100);
  const padded = rest.length < 2 ? '0' + rest : rest;
  return (negative ? '-¥' : '¥') + dollars + '.' + padded;
}

/** 新实现 —— 所有调用点最终都应该指向这里 */
function formatMoney(cents) {
  return '¥' + (cents / 100).toFixed(2);
}

module.exports = { legacyFormat, formatMoney };