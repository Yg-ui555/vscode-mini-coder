/**
 * 导出用户。
 */
const { formatUserId } = require('../../../core/src/user/formatId');

/** 生成导出行 */
function exportRows(users) {
  return (users || []).map((u) => [formatUserId(u), String(u.name || '')]);
}

module.exports = { exportRows };
