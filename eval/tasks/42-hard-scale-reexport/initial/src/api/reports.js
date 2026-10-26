/**
 * 报表接口。
 */
const { formatDate } = require('../core/date');

/** 生成一份日报的元信息 */
function reportMeta(day) {
  return { day: formatDate(day), generatedAt: Date.now() };
}

module.exports = { reportMeta };
