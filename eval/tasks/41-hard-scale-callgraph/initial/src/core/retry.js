/**
 * 重试 —— 带指数退避的同步重试。
 *
 * ⚠️ 只重试【可重试】的错误：
 *   参数写错了重试一万次也没用，纯属浪费。
 */
const { JobError } = require('./errors');

/**
 * 跑一个可能失败的操作。
 *
 * @param {function} fn          要跑的函数
 * @param {number}   [retries]   最多重试几次（不含首次）
 * @param {function} [shouldRetry] 判定这个错误该不该重试
 */
function withRetry(fn, retries, shouldRetry) {
  const max = retries === undefined ? 3 : retries;
  const retryable = shouldRetry || ((e) => e && e.name === 'JobError');
  let lastError = null;

  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      return fn(attempt);
    } catch (e) {
      lastError = e;
      if (!retryable(e) || attempt === max) break;
    }
  }
  throw lastError;
}

/** 指数退避的等待时长（毫秒） */
function backoff(attempt, base) {
  const b = base === undefined ? 50 : base;
  return b * Math.pow(2, attempt);
}

module.exports = { withRetry, backoff };
