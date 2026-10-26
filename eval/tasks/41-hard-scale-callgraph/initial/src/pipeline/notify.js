/**
 * 通知群发流程。
 */
const registry = require('../core/registry');

/** 跑一遍通知群发 */
function runNotify(input) {
  const steps = [];
  steps.push(registry.dispatch('notify.sms', input));
  steps.push(registry.dispatch('notify.push', input));
  steps.push(registry.dispatch('notify.webhook', input));
  return { steps };
}

module.exports = { runNotify };
