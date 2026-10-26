/**
 * emoji 统计。
 */
const { analyze } = require('../analyzer');

/** emoji 数量 */
function derive(text) {
  return analyze(text).emoji;
}

module.exports = { derive };
