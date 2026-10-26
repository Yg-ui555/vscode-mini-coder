/**
 * 账单域 · 发起退款
 *
 * 内置 handler 采用【自注册】：这个文件被 require 的同时把自己登记进注册表，
 * 这样新增一个 handler 不用去改任何中央清单。
 */
const { register } = require('../../core/registry');

function run(input) {
  const amount = Math.round(Number(input.amount) || 0);
  const label = String(input.label == null ? '' : input.label);
  return { group: 'billing', name: 'refund', amount, label, total: amount * 2 };
}

register('billing.refund', run);

module.exports = { kind: 'billing.refund', run };
