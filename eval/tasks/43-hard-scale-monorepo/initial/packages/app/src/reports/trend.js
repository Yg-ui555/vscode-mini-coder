/**
 * 趋势计算。
 */

/** 按天分组 */
function groupByDay(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const key = String(r.day || '');
    out.set(key, (out.get(key) || 0) + (Number(r.value) || 0));
  }
  return out;
}

/** 计算环比 */
function delta(current, previous) {
  if (!previous) return 0;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

module.exports = { groupByDay, delta };
