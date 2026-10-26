/**
 * 段落数。
 */
const { analyze } = require('../analyzer');

/** 段落数 */
function derive(text) {
  return analyze(text).paragraphs;
}

module.exports = { derive };
