/**
 * 分页。
 */

/**
 * 把一个列表切成一页。
 *
 * @returns {{ items: any[], page: number, pages: number, total: number }}
 */
function paginate(list, page, size) {
  const items = list || [];
  const s = size > 0 ? size : 20;
  const pages = Math.max(1, Math.ceil(items.length / s));
  const p = Math.min(Math.max(1, page || 1), pages);
  return { items: items.slice((p - 1) * s, p * s), page: p, pages, total: items.length };
}

module.exports = { paginate };
