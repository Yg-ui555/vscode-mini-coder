/**
 * 夜间结算流程。
 */
const registry = require('../core/registry');

/** 跑一遍夜间流程 */
function runNightly(input) {
  const steps = [];
  steps.push(registry.dispatch('billing.invoice', input));
  steps.push(registry.dispatch('billing.tax', input));
  steps.push(registry.dispatch('shipping.rate', input));
  steps.push(registry.dispatch('inventory.stock', input));
  return { steps };
}

module.exports = { runNightly };
