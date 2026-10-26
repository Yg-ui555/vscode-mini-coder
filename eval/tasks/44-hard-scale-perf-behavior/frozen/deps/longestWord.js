/**
 * 最长词。
 */
const { analyze } = require('../analyzer');

/** 最长的词 */
function derive(text) {
  return analyze(text).longestWord;
}

module.exports = { derive };
