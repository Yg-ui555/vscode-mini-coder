/**
 * 取数组的一段
 *
 * 典型用法：
 *   const { sliceRange } = require('./slice');
 *   sliceRange([10, 20, 30, 40], 1, 3);   // 期望 [20, 30]
 *
 * 约定：start / end 都是下标，从 0 开始数；end 的含义跟原生 slice 一样（不含）。
 */

/**
 * 取数组的一段
 * @param {Array} arr
 * @param {number} start 起始下标
 * @param {number} end   结束下标
 * @returns {Array}
 */
function sliceRange(arr, start, end) {
  return arr.slice(start, end + 1);
}

/**
 * 取数组的第一个和最后一个元素
 * @param {Array} arr
 * @returns {Array|null} 长度为 2 的数组；空数组返回 null
 */
function firstAndLast(arr) {
  if (arr.length === 0) return null;
  return [arr[0], arr[arr.length - 1]];
}

module.exports = { sliceRange, firstAndLast };