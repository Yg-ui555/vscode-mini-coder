/**
 * 日志适配层 —— 把 job 执行的来龙去脉记下来。
 */
const logger = require('../core/logger');

/** 记录一次执行 */
function trace(scope, kind, input) {
  logger.debug(scope, 'run ' + kind + ' ' + JSON.stringify(input));
}

/** 记录一次失败 */
function failure(scope, kind, e) {
  logger.error(scope, 'fail ' + kind + ': ' + (e && e.message ? e.message : e));
}

module.exports = { trace, failure };
