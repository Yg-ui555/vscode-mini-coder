/**
 * app 侧格式化。
 */
const { formatMoney } = require('../../../core/src/util/money');

/** 金额 */
function money(cents) {
  return formatMoney(cents);
}

/** 百分比 */
function percent(n) {
  return (Math.round((Number(n) || 0) * 1000) / 10).toFixed(1) + '%';
}

module.exports = { money, percent };
