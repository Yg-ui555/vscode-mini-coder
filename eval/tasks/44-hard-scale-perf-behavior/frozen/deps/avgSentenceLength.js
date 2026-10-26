/**
 * 平均句长。
 */
const { analyze } = require('../analyzer');

/** 平均句长 */
function derive(text) {
  return analyze(text).avgSentenceLength;
}

module.exports = { derive };
