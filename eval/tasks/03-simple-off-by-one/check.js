/**
 * 验收脚本 —— 03-simple-off-by-one
 * 判定是二值的：断言全过 or 有挂
 */

const assert = require('assert');
const path = require('path');

module.exports = {
  taskId: '03-simple-off-by-one',

  cases: [
    {
      name: '正常区间：end 不含（off-by-one 已修复）',
      fn: ({ dir }) => {
        const { sliceRange } = require(path.join(dir, 'slice.js'));
        assert.deepStrictEqual(
          sliceRange([1, 2, 3, 4], 1, 3),
          [2, 3],
          'end 应不含：取下标 1 和 2 的元素，不能把下标 3 的也带上',
        );
        assert.deepStrictEqual(
          sliceRange(['a', 'b', 'c'], 0, 2),
          ['a', 'b'],
          '从 0 开始取到 1，应得到前两个元素',
        );
      },
    },
    {
      name: '空区间：start == end 返回空数组',
      fn: ({ dir }) => {
        const { sliceRange } = require(path.join(dir, 'slice.js'));
        assert.deepStrictEqual(
          sliceRange([1, 2, 3, 4, 5], 2, 2),
          [],
          'start == end 是空区间，不该返回一个元素',
        );
        assert.deepStrictEqual(sliceRange([1, 2, 3], 0, 0), [], '从 0 取到 0 应为空');
      },
    },
    {
      name: '边界：end 超出长度按原生 slice 截断（回归守卫）',
      fn: ({ dir }) => {
        const { sliceRange } = require(path.join(dir, 'slice.js'));
        assert.deepStrictEqual(
          sliceRange([1, 2, 3], 0, 10),
          [1, 2, 3],
          'end 超出长度应返回到数组末尾为止',
        );
        assert.deepStrictEqual(
          sliceRange([1, 2, 3], 1, 99),
          [2, 3],
          'start 之后的元素应全部返回',
        );
      },
    },
    {
      name: '边界：start 大于 end 返回空数组（回归守卫）',
      fn: ({ dir }) => {
        const { sliceRange } = require(path.join(dir, 'slice.js'));
        assert.deepStrictEqual(
          sliceRange([1, 2, 3, 4], 3, 1),
          [],
          'start 在 end 之后应返回空数组，不能交换两个下标',
        );
      },
    },
    {
      name: '非法输入返回 [] 且不抛异常',
      fn: ({ dir }) => {
        const { sliceRange } = require(path.join(dir, 'slice.js'));
        assert.doesNotThrow(() => sliceRange(null, 0, 1), '传 null 不应抛异常');
        assert.doesNotThrow(() => sliceRange(undefined, 0, 2), '传 undefined 不应抛异常');
        assert.deepStrictEqual(sliceRange(null, 0, 1), [], '传 null 应返回 []');
        assert.deepStrictEqual(sliceRange(123, 0, 1), [], '传数字应返回 []');
        assert.deepStrictEqual(sliceRange('abc', 0, 2), [], '传字符串应返回 []');
      },
    },
    {
      name: '回归守卫：firstAndLast 行为没被改坏',
      fn: ({ dir }) => {
        const { firstAndLast } = require(path.join(dir, 'slice.js'));
        assert.deepStrictEqual(firstAndLast([1, 2, 3]), [1, 3], '应返回首尾元素');
        assert.deepStrictEqual(firstAndLast(['x']), ['x', 'x'], '单元素数组首尾相同');
        assert.strictEqual(firstAndLast([]), null, '空数组应返回 null');
      },
    },
    {
      name: '副作用守卫：导出没被删、也不许改原数组',
      fn: ({ dir }) => {
        const mod = require(path.join(dir, 'slice.js'));
        assert.ok(mod, '模块应能正常导出');
        assert.strictEqual(typeof mod.sliceRange, 'function', 'sliceRange 应仍是函数');
        assert.strictEqual(typeof mod.firstAndLast, 'function', 'firstAndLast 应仍是函数');

        const arr = [1, 2, 3, 4, 5];
        const copy = arr.slice();
        const out = mod.sliceRange(arr, 1, 3);
        assert.deepStrictEqual(arr, copy, 'sliceRange 不能修改传入的数组');
        assert.ok(Array.isArray(out), '返回值应是新数组');
      },
    },
  ],
};