/**
 * 库存域 · 库存盘点
 *
 * 内置 handler 采用【自注册】：这个文件被 require 的同时把自己登记进注册表，
 * 这样新增一个 handler 不用去改任何中央清单。
 */
const { register } = require('../../core/registry');
const { ok } = require('../../core/contract');

function run(input) {
  const amount = Math.round(Number(input.amount) || 0);
  const label = String(input.label == null ? '' : input.label);
  return ok({ group: 'inventory', name: 'audit', amount, label, total: amount * 2 });
}

register('inventory.audit', run);

module.exports = { kind: 'inventory.audit', run };
