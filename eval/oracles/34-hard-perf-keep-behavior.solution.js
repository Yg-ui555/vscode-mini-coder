/**
 * 标准答案 —— 34-hard-perf-keep-behavior
 *
 * 目的：证明这道题【有解】。
 *
 * 标准解法：加一个【结果缓存】，key 覆盖所有会影响结果的输入。
 *
 * ⚠️ 本题最关键的一行是 cacheKey 里那三个字段：
 *   只用 query 做 key 是【错的】——
 *   同一个 query 换 options 结果就变了，会直接串味。
 *
 * ⚠️ 第二个关键点：key 用的是【生效后的值】（缺省值归一化），
 *   所以 { limit: 10 } 和 { limit: 10, includeDrafts: false, tag: null }
 *   命中同一条缓存 —— 它们的结果本来就一样，不该算两次。
 *
 * ⚠️ 第三个关键点：原始的排序/截断/匹配逻辑【一个字都没改】，
 *   只是把它挪进了 computeResults()，外面套了一层缓存。
 */

const fs = require('fs');
const path = require('path');

/** 替换并校验锚点存在 */
function replaceOnce(src, from, to, where) {
  if (!src.includes(from)) {
    throw new Error(`标准答案锚点没找到（${where}）：\n${from}`);
  }
  return src.replace(from, to);
}

/** 读改写 */
function patch(dir, rel, fn) {
  const p = path.join(dir, rel);
  const src = fs.readFileSync(p, 'utf-8');
  fs.writeFileSync(p, fn(src), 'utf-8');
}

module.exports = {
  taskId: '34-hard-perf-keep-behavior',

  apply(dir) {
    patch(dir, 'src/search.js', (src) => {
      let out = src;

      // ── 1. 把原函数拆成"算"和"查缓存"两层 ──
      out = replaceOnce(
        out,
        [
          'function searchArticles(query, options) {',
          '  const opts = options || {};',
          '  const limit = opts.limit === undefined ? 10 : opts.limit;',
          '  const includeDrafts = opts.includeDrafts === undefined ? false : opts.includeDrafts;',
          '  const tag = opts.tag === undefined ? null : opts.tag;',
          '',
          "  const q = String(query).trim().toLowerCase();",
          '',
          '  const scored = [];',
        ].join('\n'),
        [
          '/**',
          ' * 缓存的 key：必须覆盖【所有会影响结果的输入】',
          ' *',
          ' * ⚠️ 只用 query 做 key 是错的 —— options 一换结果就变了，会串味。',
          ' * ⚠️ 用的是【生效后的值】（缺省值归一化），',
          ' *    所以 { limit: 10 } 和 { limit: 10, includeDrafts: false, tag: null }',
          ' *    命中同一条缓存 —— 它们的结果本来就一样。',
          ' */',
          'function cacheKey(query, options) {',
          '  const opts = options || {};',
          '  const limit = opts.limit === undefined ? 10 : opts.limit;',
          '  const includeDrafts = opts.includeDrafts === undefined ? false : opts.includeDrafts;',
          '  const tag = opts.tag === undefined ? null : opts.tag;',
          '  return [String(query).trim().toLowerCase(), limit, includeDrafts, tag].join(\'|\');',
          '}',
          '',
          'const RESULT_CACHE = new Map();',
          '',
          '/**',
          ' * 真正算结果的地方（原始逻辑，一个字都没改）',
          ' */',
          'function computeResults(query, options) {',
          '  const opts = options || {};',
          '  const limit = opts.limit === undefined ? 10 : opts.limit;',
          '  const includeDrafts = opts.includeDrafts === undefined ? false : opts.includeDrafts;',
          '  const tag = opts.tag === undefined ? null : opts.tag;',
          '',
          "  const q = String(query).trim().toLowerCase();",
          '',
          '  const scored = [];',
        ].join('\n'),
        'src/search.js / 拆出 computeResults',
      );

      // ── 2. 外面套一层带缓存的 searchArticles ──
      out = replaceOnce(
        out,
        [
          '  scored.sort((a, b) => b.score - a.score);',
          '',
          '  return scored.slice(0, limit);',
          '}',
          '',
          'module.exports = { searchArticles };',
        ].join('\n'),
        [
          '  scored.sort((a, b) => b.score - a.score);',
          '',
          '  return scored.slice(0, limit);',
          '}',
          '',
          '/**',
          ' * 搜索文章（带结果缓存）',
          ' */',
          'function searchArticles(query, options) {',
          '  const key = cacheKey(query, options);',
          '',
          '  const hit = RESULT_CACHE.get(key);',
          '  if (hit) {',
          '    // 返回副本：调用方要是改了返回的数组，不能把缓存污染了',
          '    return hit.slice();',
          '  }',
          '',
          '  const result = computeResults(query, options);',
          '  RESULT_CACHE.set(key, result);',
          '  return result.slice();',
          '}',
          '',
          'module.exports = { searchArticles };',
        ].join('\n'),
        'src/search.js / 加缓存',
      );

      return out;
    });
  },
};
