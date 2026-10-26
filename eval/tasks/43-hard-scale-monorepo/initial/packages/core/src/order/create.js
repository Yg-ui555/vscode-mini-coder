/**
 * 创建订单。
 */
const { nextId } = require('../util/id');

/** 造一个订单 */
function createOrder(items, userId) {
  return {
    id: nextId('order'),
    userId: Number(userId) || 0,
    items: (items || []).slice(),
    at: Date.now(),
  };
}

module.exports = { createOrder };
