/**
 * 账单相关能力的汇总。
 */
const invoice = require('./invoice');
const tax = require('./tax');
const plan = require('./plan');
const lineItem = require('./lineItem');
const statement = require('./statement');

module.exports = {
  createInvoice: invoice.createInvoice,
  taxOf: tax.taxOf,
  getPlan: plan.getPlan,
  lineItem: lineItem.lineItem,
  sumLines: lineItem.sumLines,
  statement: statement.statement,
};
