/**
 * 验收脚本 —— 性能优化 + 行为不变
 *
 * ⭐ 本题的核心是【差分对拍】（differential testing）：
 *   把【原始实现】冻结在 check.js 里当"标准答案"，
 *   然后拿优化后的实现跟它逐个组合对比。
 *
 *   为什么不用"手写几个期望值"？
 *     手写期望值只能覆盖你想得到的那几个角落，
 *     agent 在你没覆盖的分支上改了行为，你根本发现不了。
 *     冻结参考实现 = 把【全部】行为都锁死，一个字节都不放过。
 *
 * 陷阱设计：
 *   1. ⭐⭐ 缓存 key 只用 query，漏掉 options
 *      → 同一个 query 换 options 就串味了。
 *      这是缓存最经典的 bug，而且【测试很难发现】
 *      （因为单独测每种 options 都是对的）。
 *   2. 给排序加了个"分数相同时按 id 排"的 tiebreaker
 *      → 顺序变了。原始实现是稳定排序，分数相同保持语料原始顺序。
 *   3. 把 limit 提到排序之前（先截断再排序）
 *      → 结果集变了。
 *   4. 把子串匹配换成"分词匹配"
 *      → 语义变了。
 *   5. 改语料库"减少数据量"
 *      → 结果变了。本题的语料库用哈希锁死。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/** 语料库的指纹（初始数据的 md5） */
const CORPUS_HASH = '33b3ca8329d4d4202240e0d2e08536ab';

/** 加载沙箱里的模块（每次都清缓存，保证读到的是最新代码） */
function loadMod(dir, rel) {
  const p = path.join(dir, rel);
  assert.ok(fs.existsSync(p), `文件不存在：${rel}`);
  delete require.cache[require.resolve(p)];
  return require(p);
}

/**
 * ⭐ 冻结的参考实现 —— 原始版 searchArticles 的逐字拷贝
 *
 * 它【没有缓存】、没有任何优化，就是最原始的那版。
 * 优化后的实现必须跟它【一模一样】。
 *
 * @param {object[]} corpus 语料库
 */
function refSearch(corpus, query, options) {
  const opts = options || {};
  const limit = opts.limit === undefined ? 10 : opts.limit;
  const includeDrafts = opts.includeDrafts === undefined ? false : opts.includeDrafts;
  const tag = opts.tag === undefined ? null : opts.tag;

  const q = String(query).trim().toLowerCase();

  const scored = [];

  for (const article of corpus) {
    if (!includeDrafts && article.status === 'draft') continue;
    if (tag !== null && article.tags.indexOf(tag) === -1) continue;

    let score = 0;
    if (article.title.toLowerCase().indexOf(q) !== -1) score += 10;
    if (article.body.toLowerCase().indexOf(q) !== -1) score += 1;
    if (score === 0) continue;

    scored.push({ id: article.id, title: article.title, score });
  }

  // 稳定排序：分数相同的，保持语料里的原始先后顺序
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

/**
 * 语料库指纹
 *
 * ⚠️ 分隔符用纯可打印字符（| 和换行），别用控制字符 ——
 *    控制字符会让源文件变成二进制，diff 和 code review 全都废掉。
 */
function corpusHash(corpus) {
  const h = crypto.createHash('md5');
  for (const a of corpus) {
    h.update(a.id);
    h.update('|');
    h.update(a.title);
    h.update('|');
    h.update(a.status);
    h.update('|');
    h.update(a.tags.join(','));
    h.update('|');
    h.update(String(a.body.length));
    h.update('|');
    h.update(a.body);
    h.update('\n');
  }
  return h.digest('hex');
}

/**
 * ⭐ 对拍矩阵
 *
 * ⚠️ 顺序是【故意设计】的：
 *   · 同一个 query 配不同的 options 紧挨着放
 *     → 只用 query 做缓存 key 的实现会立刻串味
 *   · 中间还放了一次【内容完全相同】的重复组合
 *     → 验证"内容相同的 options 也应该命中缓存"
 */
const COMBOS = [
  { q: 'alpha', o: { limit: 10 } },
  { q: 'alpha', o: { limit: 10, includeDrafts: true } },
  { q: 'alpha', o: { limit: 10, tag: 'alpha' } },
  { q: 'alpha', o: { limit: 10, tag: 'alpha', includeDrafts: true } },
  { q: 'alpha', o: { limit: 10, includeDrafts: false, tag: null } },
  { q: 'alpha', o: { limit: 5 } },
  { q: 'alpha', o: { limit: 0 } },
  { q: 'alpha', o: undefined },
  { q: 'Beta', o: { limit: 10 } },
  { q: '  alpha  ', o: { limit: 10 } },
  { q: 'alpha', o: { limit: 10 } },
  { q: '', o: { limit: 3 } },
  { q: 'zzzznotfound', o: { limit: 3 } },
  { q: 'alpha', o: { limit: 3, includeDrafts: true, tag: 'beta' } },
  { q: 'theta', o: { limit: 10 } },
  { q: 'alpha guide', o: { limit: 10 } },
];

module.exports = {
  taskId: '34-hard-perf-keep-behavior',

  cases: [
    // ═══ 本题目标（baseline 挂 → after 过）═══
    {
      name: '⭐⭐⭐ 第二次【同样的】搜索必须命中缓存（耗时 < 5ms）',
      fn: ({ dir }) => {
        const { searchArticles } = loadMod(dir, 'src/search.js');
        const options = { limit: 10, includeDrafts: false, tag: null };

        // 第一次：不管多慢都行（可能是缓存未命中，也可能是你在建索引）
        searchArticles('alpha', options);

        const t0 = Date.now();
        searchArticles('alpha', options);
        const elapsed = Date.now() - t0;

        assert.ok(
          elapsed < 5,
          `第二次同样的搜索耗时 ${elapsed}ms（要求 < 5ms）—— ` +
            `重复的搜索没有走缓存，还是每次都全量扫语料`,
        );
      },
    },
    {
      name: '⭐⭐⭐ 性能：60 次同样的搜索，总耗时 < 300ms',
      fn: ({ dir }) => {
        const { searchArticles } = loadMod(dir, 'src/search.js');
        const options = { limit: 10, includeDrafts: false, tag: null };

        searchArticles('alpha', options); // 预热，把 JIT 编译时间排除在测量之外

        const t0 = Date.now();
        for (let i = 0; i < 60; i++) searchArticles('alpha', options);
        const elapsed = Date.now() - t0;

        assert.ok(
          elapsed < 300,
          `60 次同样的搜索耗时 ${elapsed}ms，超过 300ms ` +
            `（优化前单次约 15ms，60 次约 900ms）`,
        );
      },
    },
    {
      name: '⭐⭐ 性能：20 轮 × 3 种 options（共 60 次），总耗时 < 300ms',
      fn: ({ dir }) => {
        const { searchArticles } = loadMod(dir, 'src/search.js');
        const variants = [
          { limit: 10, includeDrafts: false, tag: null },
          { limit: 5, includeDrafts: true, tag: null },
          { limit: 20, includeDrafts: false, tag: 'alpha' },
        ];

        for (const v of variants) searchArticles('alpha', v); // 预热

        const t0 = Date.now();
        for (let r = 0; r < 20; r++) {
          for (const v of variants) searchArticles('alpha', v);
        }
        const elapsed = Date.now() - t0;

        assert.ok(
          elapsed < 300,
          `60 次搜索（3 种 options 轮着来）耗时 ${elapsed}ms，超过 300ms`,
        );
      },
    },

    // ═══ 回归守卫（baseline 必须通过，after 也必须通过）═══
    {
      name: '⭐⭐⭐ 搜索结果和原始实现【完全一致】（16 组组合逐一对拍）',
      fn: ({ dir }) => {
        const { searchArticles } = loadMod(dir, 'src/search.js');
        const { CORPUS } = loadMod(dir, 'src/corpus.js');

        for (let i = 0; i < COMBOS.length; i++) {
          const { q, o } = COMBOS[i];
          const expected = refSearch(CORPUS, q, o);
          const actual = searchArticles(q, o);
          try {
            assert.deepStrictEqual(actual, expected);
          } catch {
            throw new Error(
              `第 ${i + 1} 组组合结果不一致：\n` +
                `  query   = ${JSON.stringify(q)}\n` +
                `  options = ${JSON.stringify(o)}\n` +
                `  期望    = ${JSON.stringify(expected).slice(0, 400)}\n` +
                `  实际    = ${JSON.stringify(actual).slice(0, 400)}\n` +
                `  ⚠️ 性能优化【不允许改变任何一个结果】`,
            );
          }
        }
      },
    },
    {
      name: '⭐⭐⭐ 同一个 query 换 options，缓存不能串味',
      fn: ({ dir }) => {
        const { searchArticles } = loadMod(dir, 'src/search.js');
        const { CORPUS } = loadMod(dir, 'src/corpus.js');

        // ⚠️ 这四组必须【按这个顺序】跑：
        //   缓存 key 只用 query 的实现，会把第一组的结果发给后三组。
        const seq = [
          { q: 'alpha', o: { limit: 10 } },
          { q: 'alpha', o: { limit: 10, includeDrafts: true } },
          { q: 'alpha', o: { limit: 10, tag: 'alpha' } },
          { q: 'alpha', o: { limit: 10, includeDrafts: true, tag: 'alpha' } },
        ];

        for (let i = 0; i < seq.length; i++) {
          const { q, o } = seq[i];
          const expected = refSearch(CORPUS, q, o);
          const actual = searchArticles(q, o);
          assert.deepStrictEqual(
            actual,
            expected,
            `第 ${i + 1} 组串味了：query=${JSON.stringify(q)} options=${JSON.stringify(o)}\n` +
              `  期望 = ${JSON.stringify(expected).slice(0, 300)}\n` +
              `  实际 = ${JSON.stringify(actual).slice(0, 300)}\n` +
              `  ⚠️ 缓存的 key 必须覆盖【所有会影响结果的输入】，不只是 query`,
          );
        }
      },
    },
    {
      name: '回归守卫：语料库一个字节都没改',
      fn: ({ dir }) => {
        const { CORPUS } = loadMod(dir, 'src/corpus.js');
        const hash = corpusHash(CORPUS);
        assert.strictEqual(
          hash,
          CORPUS_HASH,
          `语料库被改了（指纹 ${hash}）—— 本题考的是"性能优化但行为不变"，` +
            `改数据等于换了一道题`,
        );
      },
    },
    {
      name: '回归守卫：searchArticles 的导出没变',
      fn: ({ dir }) => {
        const mod = loadMod(dir, 'src/search.js');
        assert.strictEqual(typeof mod.searchArticles, 'function', 'searchArticles 未导出');
        assert.strictEqual(
          mod.searchArticles.length,
          2,
          'searchArticles 的参数个数变了（query, options）—— 现有调用方依赖这个签名',
        );
      },
    },
    {
      name: '回归守卫：返回的是数组，且每项只有 id / title / score',
      fn: ({ dir }) => {
        const { searchArticles } = loadMod(dir, 'src/search.js');
        const out = searchArticles('alpha', { limit: 3 });
        assert.ok(Array.isArray(out), '返回值必须是数组');
        for (const item of out) {
          assert.deepStrictEqual(
            Object.keys(item).sort(),
            ['id', 'score', 'title'],
            `结果项的字段变了：${JSON.stringify(Object.keys(item))}`,
          );
        }
      },
    },
    {
      name: '回归守卫：分数相同的记录保持语料原始顺序（稳定排序）',
      fn: ({ dir }) => {
        const { searchArticles } = loadMod(dir, 'src/search.js');
        const out = searchArticles('alpha', { limit: 6 });
        // 'alpha' 的命中项分数全都是 11，原始顺序是 doc-8, doc-16, doc-24, ...
        const ids = out.map((x) => x.id);
        assert.deepStrictEqual(
          ids,
          ['doc-8', 'doc-16', 'doc-24', 'doc-32', 'doc-40', 'doc-48'],
          `顺序不对：${JSON.stringify(ids)}\n` +
            `⚠️ 原始实现是稳定排序，分数相同就保持语料里的原始顺序，` +
            `不要自作主张加 tiebreaker`,
        );
      },
    },
  ],
};
