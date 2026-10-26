/**
 * 日期工具 —— 全部走 UTC，避免在不同的机器上算出不同的结果。
 */

/** 格式化成 YYYY-MM-DD */
function formatDate(ts) {
  const d = new Date(ts === undefined ? Date.now() : ts);
  return d.toISOString().slice(0, 10);
}

/** 解析 YYYY-MM-DD，解析不出来返回 null */
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  return new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00Z').getTime();
}

/** 加天数 */
function addDays(dateStr, days) {
  const ts = parseDate(dateStr);
  if (ts === null) return null;
  const d = new Date(ts);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 相差几天 */
function diffDays(a, b) {
  const ta = parseDate(a);
  const tb = parseDate(b);
  if (ta === null || tb === null) return 0;
  return Math.round((ta - tb) / 86400000);
}

/** 当天起点的时间戳 */
function startOfDay(ts) {
  const d = new Date(ts === undefined ? Date.now() : ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

module.exports = { formatDate, parseDate, addDays, diffDays, startOfDay };
