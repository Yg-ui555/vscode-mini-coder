/**
 * 日期工具（UTC）。
 */

/** 格式化成 YYYY-MM-DD */
function formatDate(ts) {
  const d = new Date(ts === undefined ? Date.now() : ts);
  return d.toISOString().slice(0, 10);
}

/** 加天数 */
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = { formatDate, addDays };
