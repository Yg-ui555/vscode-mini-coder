/**
 * 句子数。
 */
const { analyze } = require('../analyzer');

/** 句子数 */
function derive(text) {
  return analyze(text).sentences;
}

module.exports = { derive };
