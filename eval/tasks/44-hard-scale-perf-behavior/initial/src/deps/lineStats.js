/**
 * 行统计。
 */
const { analyze } = require('../analyzer');

/** { lines, words } */
function derive(text) {
  const s = analyze(text);
  let words = 0;
  for (const l of s.lineStats) words += l.words;
  return { lines: s.lines, words: words };
}

module.exports = { derive };
