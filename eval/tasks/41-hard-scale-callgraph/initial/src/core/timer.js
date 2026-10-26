/**
 * 时间工具 —— 全部走 UTC，避免测试在本地时区下 flaky。
 */

/** 当前时间戳（毫秒） */
function now() {
  return Date.now();
}

/** 当前时间的 ISO 串 */
function isoNow() {
  return new Date().toISOString();
}

/**
 * 把时间戳格式化成 YYYY-MM-DD。
 *
 * ⚠️ 手工切 UTC 字段，而不是 toLocaleDateString() ——
 *    toLocaleDateString 受运行环境时区影响，评测在不同机器上结果会不一样。
 */
function formatDate(ts) {
  const d = new Date(ts === undefined ? Date.now() : ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/** 两个时间戳之间差了多少秒 */
function diffSeconds(a, b) {
  return Math.round((a - b) / 1000);
}

module.exports = { now, isoNow, formatDate, diffSeconds };
