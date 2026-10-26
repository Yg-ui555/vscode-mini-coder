/**
 * 标签云。
 */
const { chunk } = require('../core/array');

/** 把标签分成若干列 */
function tagColumns(tags, perColumn) {
  return chunk(tags || [], perColumn || 3);
}

module.exports = { tagColumns };
