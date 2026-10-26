/**
 * 指标适配层 —— 统计每个 kind 跑了多少次、成了多少次。
 */
const metrics = require('../core/metrics');

/** 记录一次成功 */
function success(kind) {
  metrics.increment('job.ok.' + kind);
}

/** 记录一次失败 */
function failure(kind) {
  metrics.increment('job.fail.' + kind);
}

/** 读取全部指标 */
function all() {
  return metrics.snapshot();
}

module.exports = { success, failure, all };
