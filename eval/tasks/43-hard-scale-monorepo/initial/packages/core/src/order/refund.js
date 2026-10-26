/**
 * 退款单。
 */
const { nextId } = require('../util/id');

/** 造一张退款单 */
function createRefund(order, amount) {
  return { id: nextId('refund'), orderId: order && order.id, amount: Math.round(amount) || 0 };
}

module.exports = { createRefund };
