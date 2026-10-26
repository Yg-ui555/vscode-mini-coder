/**
 * 账单域 · 催缴策略
 *
 * 内置 handler 采用【自注册】：这个文件被 require 的同时把自己登记进注册表，
 * 这样新增一个 handler 不用去改任何中央清单。
 */
const { register } = require('../../core/registry');
const { ok } = require('../../core/contract');

function run(input) {
  const amount = Math.round(Number(input.amount) || 0);
  const label = String(input.label == null ? '' : input.label);
  return ok({ group: 'billing', name: 'dunning', amount, label, total: amount * 2 });
}

register('billing.dunning', run);

module.exports = { kind: 'billing.dunning', run };
