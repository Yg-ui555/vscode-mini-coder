/**
 * 文档搜索
 *
 * ⚠️ 本题目标：性能优化，但【行为一个字都不能变】。
 *
 * 现在每次搜索都会：
 *   1. 遍历全部语料
 *   2. 对每篇文章的 title 和 body 各调一次 toLowerCase()  ← 每次搜索都重新转一遍
 *   3. 做子串匹配
 *
 * 真实场景：搜索框每敲一下就发一次请求（防抖后），
 *           用户来回改关键词，同一个 query 会被反复搜好几遍。
 *           现在一次搜索要几百毫秒，页面明显发木。
 */

const { CORPUS } = require('./corpus');

/**
 * 搜索文章
 *
 * @param {string} query 关键词
 * @param {{limit?: number, includeDrafts?: boolean, tag?: string|null}} options
 * @returns {{id: string, title: string, score: number}[]}
 */
function searchArticles(query, options) {
  const opts = options || {};
  const limit = opts.limit === undefined ? 10 : opts.limit;
  const includeDrafts = opts.includeDrafts === undefined ? false : opts.includeDrafts;
  const tag = opts.tag === undefined ? null : opts.tag;

  const q = String(query).trim().toLowerCase();

  const scored = [];

  for (const article of CORPUS) {
    if (!includeDrafts && article.status === 'draft') continue;
    if (tag !== null && article.tags.indexOf(tag) === -1) continue;

    let score = 0;
    if (article.title.toLowerCase().indexOf(q) !== -1) score += 10;
    if (article.body.toLowerCase().indexOf(q) !== -1) score += 1;
    if (score === 0) continue;

    scored.push({ id: article.id, title: article.title, score });
  }

  // ⭐ 稳定排序：分数相同的，保持语料里的原始先后顺序
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

module.exports = { searchArticles };
