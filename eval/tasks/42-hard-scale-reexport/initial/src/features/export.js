/**
 * 导出。
 */
const { formatDate } = require('../core/date');

/** 生成导出文件名 */
function exportFileName(prefix, ts) {
  return String(prefix || 'export') + '-' + formatDate(ts) + '.csv';
}

module.exports = { exportFileName };
