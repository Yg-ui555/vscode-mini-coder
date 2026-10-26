/**
 * 配送下发流程。
 */
const registry = require('../core/registry');

/** 跑一遍配送下发 */
function runDispatch(input) {
  const steps = [];
  steps.push(registry.dispatch('shipping.label', input));
  steps.push(registry.dispatch('shipping.dispatch', input));
  steps.push(registry.dispatch('shipping.track', input));
  return { steps };
}

module.exports = { runDispatch };
