/**
 * 新用户接入流程。
 */
const registry = require('../core/registry');

/** 跑一遍接入流程 */
function runOnboarding(input) {
  const steps = [];
  steps.push(registry.dispatch('billing.subscription', input));
  steps.push(registry.dispatch('notify.preference', input));
  steps.push(registry.dispatch('inventory.audit', input));
  return { steps };
}

module.exports = { runOnboarding };
