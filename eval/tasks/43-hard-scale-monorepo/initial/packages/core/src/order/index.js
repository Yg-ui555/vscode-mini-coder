/**
 * 订单相关能力的汇总。
 */
const create = require('./create');
const total = require('./total');
const status = require('./status');
const discount = require('./discount');
const refund = require('./refund');

module.exports = {
  createOrder: create.createOrder,
  orderTotal: total.orderTotal,
  nextStatus: status.nextStatus,
  isFinal: status.isFinal,
  findRule: discount.findRule,
  applyDiscount: discount.applyDiscount,
  createRefund: refund.createRefund,
};
