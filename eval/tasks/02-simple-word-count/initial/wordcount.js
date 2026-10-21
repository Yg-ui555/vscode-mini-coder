/**
 * 统计文本里的词频
 *
 * 典型用法：
 *   const { countWords } = require('./wordcount');
 *   countWords('a b a');   // => { a: 2, b: 1 }
 *
 * 约定：返回对象的 key 就是词，value 是这个词出现的次数。
 */

/**
 * 统计每个词出现了多少次
 * @param {string} text
 * @returns {Object<string, number>}
 */
function countWords(text) {
  const words = text.split(' ');
  const counts = {};
  for (const w of words) {
    counts[w] = (counts[w] || 0) + 1;
  }
  return counts;
}

/**
 * 一共有多少个不同的词
 * @param {string} text
 * @returns {number}
 */
function countUniqueWords(text) {
  const counts = countWords(text);
  return Object.keys(counts).length;
}

module.exports = { countWords, countUniqueWords };