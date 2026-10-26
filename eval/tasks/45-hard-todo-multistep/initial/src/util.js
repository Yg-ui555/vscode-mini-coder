/**
 * 金额工具（公共）
 *
 * ⚠️ 下面两个函数是同一段逻辑的两份拷贝：
 *    `yuanStr` 是从 calc.js 抄过来的，`centsToYuan` 是从 format.js 抄过来的，
 *    两段代码一个字不差。
 */

/** calc.js 那边的拷贝 */
function yuanStr(cents) {
  const abs = Math.abs(cents);
  if (abs === 0) return '0';
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return `${yuan}.${fen < 10 ? '0' + fen : fen}`;
}

/** format.js 那边的拷贝 */
function centsToYuan(cents) {
  const abs = Math.abs(cents);
  if (abs === 0) return '0';
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return `${yuan}.${fen < 10 ? '0' + fen : fen}`;
}

module.exports = { yuanStr, centsToYuan };
