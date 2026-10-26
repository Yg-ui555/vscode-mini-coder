/**
 * 基础算术工具 —— 目前只实现了加法。
 */

const { round2 } = require('./util');

/**
 * 两数相加。
 *
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function add(a, b) {
  return round2(a + b);
}

module.exports = { add };
