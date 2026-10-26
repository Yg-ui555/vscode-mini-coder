/**
 * 错误类型。
 *
 * 分成"业务错误"和"系统错误"是为了让调用方能区别对待：
 *   业务错误 → 可以重试或者降级
 *   系统错误 → 重试也没用，直接往上抛
 */

/** 业务错误：调用方能理解、能处理的 */
class JobError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'JobError';
    this.code = code || 'JOB_ERROR';
  }
}

/** 系统错误：代码 bug 或者依赖挂了 */
class FatalError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'FatalError';
    this.cause = cause;
  }
}

/** 判断是不是业务错误 */
function isJobError(e) {
  return !!e && e.name === 'JobError';
}

module.exports = { JobError, FatalError, isJobError };
