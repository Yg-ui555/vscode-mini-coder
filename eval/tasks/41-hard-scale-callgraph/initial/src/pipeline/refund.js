/**
 * 退款流程。
 */
const registry = require('../core/registry');

/** 跑一遍退款流程 */
function runRefund(input) {
  const steps = [];
  steps.push(registry.dispatch('billing.refund', input));
  steps.push(registry.dispatch('shipping.return', input));
  steps.push(registry.dispatch('notify.email', input));
  return { steps };
}

module.exports = { runRefund };
