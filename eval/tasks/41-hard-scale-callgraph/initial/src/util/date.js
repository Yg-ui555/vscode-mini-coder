/**
 * 日期工具。
 */

/** 今天的 YYYY-MM-DD */
function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/** 加天数 */
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 两个日期差几天 */
function diffDays(a, b) {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((da - db) / 86400000);
}

module.exports = { today, addDays, diffDays };
