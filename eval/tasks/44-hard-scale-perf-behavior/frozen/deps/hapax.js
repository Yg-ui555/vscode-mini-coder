/**
 * 只出现一次的词（hapax legomena）。
 */
const { analyze } = require('../analyzer');

/** 出现恰好一次的词的数量 */
function derive(text) {
  const s = analyze(text);
  let n = 0;
  for (const word of Object.keys(s.frequencies)) {
    if (s.frequencies[word] === 1) n += 1;
  }
  return n;
}

module.exports = { derive };
