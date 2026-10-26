/**
 * 标题统计。
 */
const { analyze } = require('../analyzer');

/** 标题数量 */
function derive(text) {
  return analyze(text).headings;
}

module.exports = { derive };
