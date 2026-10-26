/**
 * 报表汇总。
 */
const { formatDate } = require('../../../core/src/util/date');

/** 生成一段汇总 */
function summarize(day, counts) {
  return { day: formatDate(day), counts: counts || {} };
}

module.exports = { summarize };
