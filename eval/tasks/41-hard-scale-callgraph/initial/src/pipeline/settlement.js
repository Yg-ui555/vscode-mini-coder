/**
 * 结算流程。
 */
const registry = require('../core/registry');

/** 跑一遍结算流程 */
function runSettlement(input) {
  const steps = [];
  steps.push(registry.dispatch('billing.payout', input));
  steps.push(registry.dispatch('billing.dunning', input));
  steps.push(registry.dispatch('inventory.shrink', input));
  return { steps };
}

module.exports = { runSettlement };
