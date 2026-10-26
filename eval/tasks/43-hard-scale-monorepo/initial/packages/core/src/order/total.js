/**
 * 订单金额计算。
 */
const { sum } = require('../util/money');

/** 订单总价（分） */
function orderTotal(order) {
  return sum((order && order.items) || []);
}

module.exports = { orderTotal };
