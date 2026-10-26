/**
 * 对账单。
 */
const { formatDate } = require('../util/date');

/** 生成对账单 */
function statement(userId, month, amount) {
  return { userId: Number(userId) || 0, month: String(month || ''), amount: Math.round(amount) || 0, at: formatDate() };
}

module.exports = { statement };
