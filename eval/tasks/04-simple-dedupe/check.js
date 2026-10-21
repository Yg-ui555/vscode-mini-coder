/**
 * 验收脚本 —— 04-simple-dedupe
 * 判定是二值的：断言全过 or 有挂
 */

const assert = require('assert');
const path = require('path');

module.exports = {
  taskId: '04-simple-dedupe',

  cases: [
    {
      name: '正常去重：按 key 保留首次出现（回归守卫）',
      fn: ({ dir }) => {
        const { dedupeBy } = require(path.join(dir, 'dedupe.js'));
        const out = dedupeBy([{ id: 1 }, { id: 2 }, { id: 1 }, { id: 2 }], (x) => x.id);
        assert.strictEqual(out.length, 2, '同一 id 只应保留一项，共 2 项');
        assert.deepStrictEqual(out[0], { id: 1 }, '保留的应是首次出现的 { id: 1 }');
        assert.deepStrictEqual(out[1], { id: 2 }, '顺序应保持首次出现的顺序');
      },
    },
    {
      name: '回归守卫：同一个对象引用出现两次只保留一次',
      fn: ({ dir }) => {
        const { dedupeBy } = require(path.join(dir, 'dedupe.js'));
        const shared = { name: 'a' };
        const out = dedupeBy([shared, shared], (x) => x.id);
        assert.strictEqual(out.length, 1, '同一个引用出现两次只应保留一次');
        assert.strictEqual(out[0], shared, '保留的应是首次出现的那一项');
      },
    },
    {
      name: '边界：空数组和单元素数组（回归守卫）',
      fn: ({ dir }) => {
        const { dedupeBy } = require(path.join(dir, 'dedupe.js'));
        assert.deepStrictEqual(dedupeBy([], (x) => x.id), [], '空数组应返回 []');
        const only = { id: 7 };
        const out = dedupeBy([only], (x) => x.id);
        assert.strictEqual(out.length, 1, '单元素数组应保留 1 项');
        assert.strictEqual(out[0], only, '应是原对象本身');
      },
    },
    {
      name: 'keyFn 返回 undefined 的不同元素不能被吞掉',
      fn: ({ dir }) => {
        const { dedupeBy } = require(path.join(dir, 'dedupe.js'));
        const out = dedupeBy([{ name: 'a' }, { name: 'b' }, { name: 'a' }], (x) => x.id);
        assert.strictEqual(
          out.length,
          3,
          '三个互不相同的对象，keyFn 都返回 undefined，应按元素本身区分，保留 3 项',
        );
        const primitives = dedupeBy([1, 1, 2], () => undefined);
        assert.deepStrictEqual(primitives, [1, 2], '原始值按值去重，1 只留一个');
      },
    },
    {
      name: '部分 undefined 与有效 key 混合时要都保留',
      fn: ({ dir }) => {
        const { dedupeBy } = require(path.join(dir, 'dedupe.js'));
        const out = dedupeBy([{ id: 1 }, { name: 'x' }, { id: 1 }, { name: 'y' }], (x) => x.id);
        assert.strictEqual(
          out.length,
          3,
          '两个缺 id 的对象不能互相吞掉：id 重复的只剩一项，缺 id 的两项都该留下',
        );
        assert.deepStrictEqual(out[1], { name: 'x' }, '第一个缺 id 的项应保留');
        assert.deepStrictEqual(out[2], { name: 'y' }, '第二个缺 id 的项应保留（原来会被 undefined 吞掉）');
      },
    },
    {
      name: '非法输入返回 [] 且不抛异常',
      fn: ({ dir }) => {
        const { dedupeBy } = require(path.join(dir, 'dedupe.js'));
        assert.doesNotThrow(() => dedupeBy(null, (x) => x.id), '传 null 不应抛异常');
        assert.doesNotThrow(() => dedupeBy(undefined, (x) => x.id), '传 undefined 不应抛异常');
        assert.deepStrictEqual(dedupeBy(null, (x) => x.id), [], '传 null 应返回 []');
        assert.deepStrictEqual(dedupeBy(123, (x) => x.id), [], '传数字应返回 []');
      },
    },
    {
      name: '回归守卫 + 副作用守卫：countBy 与导出没被改坏',
      fn: ({ dir }) => {
        const mod = require(path.join(dir, 'dedupe.js'));
        assert.ok(mod, '模块应能正常导出');
        assert.strictEqual(typeof mod.dedupeBy, 'function', 'dedupeBy 应仍是函数');
        assert.strictEqual(typeof mod.countBy, 'function', 'countBy 应仍是函数');

        const { countBy } = mod;
        assert.deepStrictEqual(
          countBy([{ t: 'a' }, { t: 'b' }, { t: 'a' }], (x) => x.t),
          { a: 2, b: 1 },
          'countBy 的分组计数行为不能被改坏',
        );
        assert.deepStrictEqual(countBy([], (x) => x.t), {}, '空数组应返回 {}');
        assert.deepStrictEqual(
          countBy([{ n: 1 }, { n: 1 }, { n: 2 }], (x) => x.n),
          { 1: 2, 2: 1 },
          'countBy 仍应把 key 存成对象属性（数字会被转成字符串 key）',
        );
      },
    },
  ],
};