/**
 * 审计报表。
 */
const { formatDate } = require('../../../core/src/util/date');

/** 生成审计条目 */
function auditRows(events) {
  return (events || []).map((e) => ({ at: formatDate(e.at), action: e.action }));
}

module.exports = { auditRows };
