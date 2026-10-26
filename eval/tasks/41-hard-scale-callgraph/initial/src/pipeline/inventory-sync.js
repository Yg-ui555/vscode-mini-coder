/**
 * 库存同步流程。
 */
const registry = require('../core/registry');

/** 跑一遍库存同步 */
function runSync(input) {
  const steps = [];
  steps.push(registry.dispatch('inventory.reorder', input));
  steps.push(registry.dispatch('inventory.transfer', input));
  return { steps };
}

module.exports = { runSync };
