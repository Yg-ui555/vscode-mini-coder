/**
 * 词频画像。
 */
const { analyze } = require('../analyzer');

/** 前 5 个高频词 */
function derive(text) {
  const s = analyze(text);
  return s.topWords.slice(0, 5);
}

module.exports = { derive };
