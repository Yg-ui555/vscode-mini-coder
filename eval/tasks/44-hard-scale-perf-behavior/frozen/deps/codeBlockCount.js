/**
 * 代码块统计。
 */
const { analyze } = require('../analyzer');

/** 围栏代码块数量 */
function derive(text) {
  return analyze(text).fencedBlocks;
}

module.exports = { derive };
