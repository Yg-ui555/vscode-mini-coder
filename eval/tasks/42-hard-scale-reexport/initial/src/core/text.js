/**
 * 文本统计工具。
 */

/** 按单词截断 */
function truncateWords(text, maxWords) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ') + '…';
}

/** 词数 */
function wordCount(text) {
  return String(text == null ? '' : text).split(/\s+/).filter(Boolean).length;
}

/** 两个字符串的相似度（0~1） */
function similarity(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  if (x === y) return 1;
  if (!x.length || !y.length) return 0;
  const d = levenshtein(x, y);
  return 1 - d / Math.max(x.length, y.length);
}

/** 压缩连续空白 */
function normalizeSpace(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

/** 编辑距离 */
function levenshtein(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  const prev = new Array(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (x[i - 1] === y[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[y.length];
}

module.exports = { truncateWords, wordCount, similarity, normalizeSpace, levenshtein };
