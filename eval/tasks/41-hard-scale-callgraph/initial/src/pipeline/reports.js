/**
 * 报表流程。
 */
const registry = require('../core/registry');

/** 跑一遍报表 */
function runReport(input) {
  const steps = [];
  steps.push(registry.dispatch('notify.digest', input));
  steps.push(registry.dispatch('inventory.audit', input));
  return { steps };
}

module.exports = { runReport };
