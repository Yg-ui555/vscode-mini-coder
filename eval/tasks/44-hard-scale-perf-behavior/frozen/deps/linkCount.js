/**
 * 链接统计。
 */
const { analyze } = require('../analyzer');

/** markdown 链接数量 */
function derive(text) {
  return analyze(text).links;
}

module.exports = { derive };
