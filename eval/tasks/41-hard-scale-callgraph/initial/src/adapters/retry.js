/**
 * 重试适配层 —— 在 job 外面包一层重试。
 */
const { withRetry } = require('../core/retry');
const registry = require('../core/registry');

/** 带重试地执行一个 job */
function run(kind, input, retries) {
  return withRetry(() => registry.dispatch(kind, input), retries);
}

module.exports = { run };
