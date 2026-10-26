/**
 * 数字工具。
 */

/** 人类可读的字节数 */
function formatBytes(bytes, digits) {
  const n = Number(bytes) || 0;
  const d = digits === undefined ? 1 : digits;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.abs(n);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value = value / 1024;
    i += 1;
  }
  return (n < 0 ? '-' : '') + value.toFixed(d) + ' ' + units[i];
}

/** 把数字夹在 [min, max] 之间 */
function clamp(n, min, max) {
  const v = Number(n) || 0;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * 解析 "1-10" 这种区间写法。
 *
 * @returns {number[]} 两个数字；解析不出来返回空数组
 */
function parseRange(spec) {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(spec || '').trim());
  if (!m) return [];
  return [Number(m[1]), Number(m[2])];
}

/** 四舍五入到指定小数位 */
function roundTo(n, digits) {
  const f = Math.pow(10, digits === undefined ? 2 : digits);
  return Math.round((Number(n) || 0) * f) / f;
}

/** 是不是整数 */
function isInteger(n) {
  return Number.isInteger(Number(n));
}

/** 转百分比字符串 */
function toPercent(n, digits) {
  return roundTo((Number(n) || 0) * 100, digits === undefined ? 1 : digits) + '%';
}

module.exports = { formatBytes, clamp, parseRange, roundTo, isInteger, toPercent };
