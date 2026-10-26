/**
 * 站内搜索。
 */
const { normalizeSpace } = require('../core/text');

/** 搜索 */
function search(items, query) {
  const q = normalizeSpace(query).toLowerCase();
  if (!q) return [];
  return items.filter((it) => String(it.title || '').toLowerCase().indexOf(q) !== -1);
}

module.exports = { search };
