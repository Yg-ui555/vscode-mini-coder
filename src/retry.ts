/**
 * 自动重试 - 网络抖了等一下再试
 *
 * 原理：LLM API 偶尔抖一下（瞬时错误），直接报错太亏
 *      类比：打客服电话占线，挂断等 1 分钟再打
 *
 * 算法：指数退避（每次等的时间翻倍）
 *   第 1 次失败 → 等 1 秒
 *   第 2 次失败 → 等 2 秒
 *   第 3 次失败 → 等 4 秒
 *
 * 不该重试的：用户配错了（401/403/404）重试也没用
 */

import { info } from './logger';

export interface RetryOptions {
  maxRetries?: number;       // 最多试几次（默认 3）
  initialDelayMs?: number;   // 第一次等多久（默认 1000ms）
  factor?: number;           // 每次延迟翻几倍（默认 2）
}

export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
  shouldRetry?: (e: any) => boolean,  // 决定这种错要不要重试
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const initialDelay = opts.initialDelayMs ?? 1000;
  const factor = opts.factor ?? 2;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 成功就返回
      return await fn();
    } catch (e: any) {
      lastError = e;

      // 最后一轮就不等了
      if (attempt === maxRetries) break;

      // 不该重试的错误直接抛出去
      if (shouldRetry && !shouldRetry(e)) throw e;

      // 算等多久：1s → 2s → 4s
      const delay = initialDelay * Math.pow(factor, attempt);
      info(`[retry] 第 ${attempt + 1} 次失败，${delay}ms 后重试 (${e?.message || e})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

/**
 * 默认的"要不要重试"判断
 *   - 4xx（用户错，比如 key 错）不重试
 *   - 5xx（服务端错）重试
 *   - NetworkError 重试
 */
export function defaultShouldRetry(e: any): boolean {
  // 网络错 → 重试
  if (e?.name === 'NetworkError') return true;

  // 401/403/404/422 用户错 → 不重试
  if (e?.status >= 400 && e?.status < 500) return false;

  // 5xx 服务端错 → 重试
  if (e?.status >= 500) return true;

  // 429 限流 → 重试
  if (e?.status === 429) return true;

  // 其他 → 重试（保守）
  return true;
}
