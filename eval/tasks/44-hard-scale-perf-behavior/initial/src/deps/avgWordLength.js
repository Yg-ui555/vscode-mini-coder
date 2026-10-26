/**
 * 平均词长。
 */
const { analyze } = require('../analyzer');

/** 平均词长 */
function derive(text) {
  return analyze(text).avgWordLength;
}

module.exports = { derive };
