/**
 * app 侧日期。
 */
const { formatDate } = require('../../../core/src/util/date');

/** 今天 */
function today() {
  return formatDate(Date.now());
}

module.exports = { today };
