/**
 * 验收脚本 —— 02-simple-word-count
 * 判定是二值的：断言全过 or 有挂
 */

const assert = require('assert');
const path = require('path');

module.exports = {
  taskId: '02-simple-word-count',

  cases: [
    {
      name: '忽略大小写：Hello / hello / HELLO 算同一个词',
      fn: ({ dir }) => {
        const { countWords } = require(path.join(dir, 'wordcount.js'));
        assert.deepStrictEqual(
          countWords('Hello hello HELLO'),
          { hello: 3 },
          '大小写不同的同一个词应该合并计数，key 用小写',
        );
      },
    },
    {
      name: '忽略标点：词尾的 , . ! 应该被剥掉',
      fn: ({ dir }) => {
        const { countWords } = require(path.join(dir, 'wordcount.js'));
        assert.deepStrictEqual(
          countWords('apple, banana. apple!'),
          { apple: 2, banana: 1 },
          '标点应从词里去掉再计数',
        );
        assert.deepStrictEqual(
          countWords('Hello, hello! HELLO'),
          { hello: 3 },
          '大小写和标点要一起处理',
        );
      },
    },
    {
      name: '空白处理：空字符串 / 纯空白 / 连续空白不产生空词',
      fn: ({ dir }) => {
        const { countWords } = require(path.join(dir, 'wordcount.js'));
        assert.deepStrictEqual(countWords(''), {}, '空字符串应返回 {}');
        assert.deepStrictEqual(countWords('   '), {}, '纯空白应返回 {}');
        assert.deepStrictEqual(
          countWords('foo  bar'),
          { foo: 1, bar: 1 },
          '连续空白只算一个分隔符，不该多出空串这个 key',
        );
      },
    },
    {
      name: '非法输入返回 {} 且不抛异常',
      fn: ({ dir }) => {
        const { countWords } = require(path.join(dir, 'wordcount.js'));
        assert.doesNotThrow(() => countWords(null), '传 null 不应抛异常');
        assert.doesNotThrow(() => countWords(undefined), '传 undefined 不应抛异常');
        assert.doesNotThrow(() => countWords(123), '传数字不应抛异常');
        assert.deepStrictEqual(countWords(null), {}, '传 null 应返回 {}');
        assert.deepStrictEqual(countWords(undefined), {}, '传 undefined 应返回 {}');
      },
    },
    {
      name: 'countUniqueWords 必须同步走新逻辑',
      fn: ({ dir }) => {
        const { countUniqueWords } = require(path.join(dir, 'wordcount.js'));
        assert.strictEqual(
          countUniqueWords('Hello hello, world!'),
          2,
          'Hello 和 hello, 应算同一个词，去掉标点后总共 2 个不同词',
        );
        assert.strictEqual(countUniqueWords(''), 0, '空字符串应有 0 个不同词');
        assert.strictEqual(
          countUniqueWords('a, b. c! d?'),
          4,
          '四个词带不同标点，仍应是 4 个不同词',
        );
      },
    },
    {
      name: '回归守卫：不含大写 / 标点的普通输入结果不变',
      fn: ({ dir }) => {
        const { countWords, countUniqueWords } = require(path.join(dir, 'wordcount.js'));
        assert.deepStrictEqual(
          countWords('foo bar foo'),
          { foo: 2, bar: 1 },
          '原本就正确的计数不能被改坏',
        );
        assert.strictEqual(countUniqueWords('a b c'), 3, '三个不同词应返回 3');
      },
    },
    {
      name: '副作用守卫：导出没被删、countUniqueWords 仍是纯统计不改数据',
      fn: ({ dir }) => {
        const mod = require(path.join(dir, 'wordcount.js'));
        assert.ok(mod, '模块应能正常导出');
        assert.strictEqual(typeof mod.countWords, 'function', 'countWords 应仍是函数');
        assert.strictEqual(typeof mod.countUniqueWords, 'function', 'countUniqueWords 应仍是函数');
        assert.strictEqual(
          mod.countUniqueWords('a a b b c'),
          3,
          'countUniqueWords 的返回值应保持"不同词个数"这个语义',
        );
        assert.strictEqual(typeof mod.countUniqueWords('x'), 'number', '应返回数字');
      },
    },
  ],
};