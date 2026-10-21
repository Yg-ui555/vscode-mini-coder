/**
 * 验收脚本
 *
 * ⭐ 本题的核心陷阱：agent 很容易"顺手"把 topN 的行为也改了
 *   （比如加个字典序 tiebreaker），这会破坏回归守卫 case。
 */

const assert = require('assert');
const path = require('path');

module.exports = {
  taskId: '13-hard-perf-optimize',

  cases: [
    // ═══ 本题目标（baseline 挂）═══
    {
      name: 'topNWithCount 已导出且是函数',
      fn: ({ dir }) => {
        const mod = require(path.join(dir, 'dedupe.js'));
        assert.strictEqual(typeof mod.topNWithCount, 'function', 'topNWithCount 未导出');
      },
    },
    {
      name: 'topNWithCount 返回 [元素, 次数] 对',
      fn: ({ dir }) => {
        const { topNWithCount } = require(path.join(dir, 'dedupe.js'));
        const arr = ['a', 'b', 'a', 'c', 'b', 'a'];
        const r = topNWithCount(arr, 3);
        assert.deepStrictEqual(r[0], ['a', 3], 'a 出现 3 次应排第一');
        assert.deepStrictEqual(r[1], ['b', 2], 'b 出现 2 次应排第二');
        assert.deepStrictEqual(r[2], ['c', 1], 'c 出现 1 次应排第三');
      },
    },
    {
      name: '⭐ topNWithCount 次数相同时按字典序升序',
      fn: ({ dir }) => {
        const { topNWithCount } = require(path.join(dir, 'dedupe.js'));
        // z 先出现，a 后出现，但次数相同 → 字典序 a 应排前
        const arr = ['z', 'a', 'z', 'a', 'm', 'm'];
        const r = topNWithCount(arr, 3);
        assert.deepStrictEqual(
          r.map((x) => x[0]),
          ['a', 'm', 'z'],
          '次数相同时应按字典序升序（a < m < z）',
        );
        assert.deepStrictEqual(r.map((x) => x[1]), [2, 2, 2], '三者次数都是 2');
      },
    },
    {
      name: 'topNWithCount 的 n 大于元素种类数时按实际数量返回',
      fn: ({ dir }) => {
        const { topNWithCount } = require(path.join(dir, 'dedupe.js'));
        const r = topNWithCount(['a', 'a', 'b'], 10);
        assert.strictEqual(r.length, 2, '只有 2 种元素，不该返回 10 个');
        assert.deepStrictEqual(r[0], ['a', 2]);
      },
    },
    {
      name: 'topNWithCount 空数组返回空数组',
      fn: ({ dir }) => {
        const { topNWithCount } = require(path.join(dir, 'dedupe.js'));
        assert.deepStrictEqual(topNWithCount([], 5), [], '空数组应返回空数组');
      },
    },
    {
      name: 'topNWithCount n=0 返回空数组',
      fn: ({ dir }) => {
        const { topNWithCount } = require(path.join(dir, 'dedupe.js'));
        assert.deepStrictEqual(
          topNWithCount(['a', 'b', 'c'], 0),
          [],
          'n=0 应返回空数组',
        );
      },
    },

    // ═══ 性能（本题核心目标）═══
    {
      name: '⭐ 性能：30000 个不同元素必须在 2 秒内算完',
      fn: ({ dir }) => {
        const { topN } = require(path.join(dir, 'dedupe.js'));
        const N = 30000;
        const arr = Array.from({ length: N }, (_, i) => `k${i}`);

        const t0 = Date.now();
        const r = topN(arr, 5);
        const elapsed = Date.now() - t0;

        assert.strictEqual(r.length, 5, '应返回 5 个');
        assert.ok(
          elapsed < 2000,
          `耗时 ${elapsed}ms，超过 2000ms —— O(n²) 没优化掉` +
            `（基线实现约需 1600ms 以上，优化后应在 50ms 内）`,
        );
      },
    },
    {
      name: '性能：30000 个元素里有重复的情况也够快',
      fn: ({ dir }) => {
        const { topNWithCount } = require(path.join(dir, 'dedupe.js'));
        const arr = [];
        for (let i = 0; i < 30000; i++) arr.push(`item${i % 5000}`);

        const t0 = Date.now();
        const r = topNWithCount(arr, 10);
        const elapsed = Date.now() - t0;

        assert.strictEqual(r.length, 10);
        assert.ok(elapsed < 2000, `耗时 ${elapsed}ms，超过 2000ms`);
      },
    },

    // ═══ 回归守卫（baseline 必须通过）═══
    {
      name: '回归守卫：topN 基本行为没变',
      fn: ({ dir }) => {
        const { topN } = require(path.join(dir, 'dedupe.js'));
        assert.deepStrictEqual(
          topN(['a', 'b', 'a', 'c', 'b', 'a'], 2),
          ['a', 'b'],
          'topN 应按次数降序返回前 2',
        );
        assert.deepStrictEqual(topN(['x'], 1), ['x']);
        assert.deepStrictEqual(topN([], 3), []);
      },
    },
    {
      name: '⭐ 回归守卫：topN 没被偷偷加上字典序 tiebreaker',
      fn: ({ dir }) => {
        // 初始实现的冒泡排序是稳定排序：
        // 次数相同时保持【Map 的插入顺序】，也就是首次出现顺序
        const { topN } = require(path.join(dir, 'dedupe.js'));
        const r = topN(['z', 'a', 'z', 'a'], 2);
        // 正确行为：z 先出现（插入顺序在前）→ 应返回 ['z','a']
        // 如果 agent 给 topN 也加了字典序，会返回 ['a','z'] —— 那是破坏行为
        assert.deepStrictEqual(r, ['z', 'a'], 'topN 不该被加上字典序排序（那是 topNWithCount 才要的）');
      },
    },
    {
      name: '回归守卫：导出方式没坏',
      fn: ({ dir }) => {
        const mod = require(path.join(dir, 'dedupe.js'));
        assert.strictEqual(typeof mod.topN, 'function', 'topN 必须是函数');
        assert.ok(mod, '模块应能正常导出');
      },
    },
  ],
};