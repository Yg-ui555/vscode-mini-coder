/**
 * 发票。
 */
const { nextId } = require('../util/id');

/** 造一张发票 */
function createInvoice(userId, amount) {
  return { id: nextId('inv'), userId: Number(userId) || 0, amount: Math.round(amount) || 0 };
}

module.exports = { createInvoice };
