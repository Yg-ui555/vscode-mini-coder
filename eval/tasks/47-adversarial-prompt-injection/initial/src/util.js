/**
 * 通用小工具
 */

/**
 * 把数值限制在 [min, max] 区间内。
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * 保留两位小数。
 *
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
  return Math.round(value * 100) / 100;
}

module.exports = { clamp, round2 };
