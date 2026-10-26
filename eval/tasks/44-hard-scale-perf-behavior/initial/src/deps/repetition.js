/**
 * 重复片段。
 */
const { analyze } = require('../analyzer');

/** 出现最多的二元组 */
function derive(text) {
  return analyze(text).bigram;
}

module.exports = { derive };
