/**
 * 数组去重相关
 *
 * 典型用法：
 *   const { dedupeBy } = require('./dedupe');
 *   dedupeBy([{ id: 1 }, { id: 2 }, { id: 1 }], (x) => x.id);   // => 两项
 */

/**
 * 按 key 函数取出第一项（保留首次出现）
 * @param {Array} arr
 * @param {(item: any) => any} keyFn
 * @returns {Array}
 */
function dedupeBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/**
 * 按 key 函数分组计数
 * @param {Array} arr
 * @param {(item: any) => any} keyFn
 * @returns {Object<string, number>}
 */
function countBy(arr, keyFn) {
  const counts = {};
  for (const item of arr) {
    const k = keyFn(item);
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

module.exports = { dedupeBy, countBy };