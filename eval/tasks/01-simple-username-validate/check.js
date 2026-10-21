/**
 * 验收脚本 —— 判定是二值的：全过 or 有挂
 * 不依赖 LLM 打分，避免自我麻醉
 */

const assert = require('assert');
const path = require('path');

module.exports = {
  taskId: '01-simple-username-validate',

  cases: [
    {
      name: '合法用户名返回 true',
      fn: ({ dir }) => {
        const { validateUsername } = require(path.join(dir, 'username.js'));
        assert.strictEqual(validateUsername('abc'), true, 'abc 应合法');
        assert.strictEqual(validateUsername('user_123'), true, 'user_123 应合法');
        assert.strictEqual(validateUsername('a_b_c'), true, 'a_b_c 应合法');
      },
    },
    {
      name: '长度边界：3 和 20 合法',
      fn: ({ dir }) => {
        const { validateUsername } = require(path.join(dir, 'username.js'));
        assert.strictEqual(validateUsername('abc'), true, '长度 3 应合法');
        const twenty = 'a'.repeat(20);
        assert.strictEqual(validateUsername(twenty), true, '长度 20 应合法');
        assert.strictEqual(validateUsername('ab'), false, '长度 2 应非法');
        assert.strictEqual(validateUsername('a'.repeat(21)), false, '长度 21 应非法');
      },
    },
    {
      name: '非法字符返回 false（不抛异常）',
      fn: ({ dir }) => {
        const { validateUsername } = require(path.join(dir, 'username.js'));
        assert.strictEqual(validateUsername('has space'), false, '空格应非法');
        assert.strictEqual(validateUsername('中文名字'), false, '中文应非法');
        assert.strictEqual(validateUsername('bad-char'), false, '连字符应非法');
        assert.strictEqual(validateUsername('a@b'), false, '@ 应非法');
      },
    },
    {
      name: '非字符串输入返回 false 且不抛异常',
      fn: ({ dir }) => {
        const { validateUsername } = require(path.join(dir, 'username.js'));
        // 原来的实现会在这些输入上抛 TypeError（name.length 不存在）
        assert.doesNotThrow(() => validateUsername(123), '传数字不应抛异常');
        assert.doesNotThrow(() => validateUsername(null), '传 null 不应抛异常');
        assert.doesNotThrow(() => validateUsername(undefined), '传 undefined 不应抛异常');
        assert.doesNotThrow(() => validateUsername({}), '传对象不应抛异常');
        assert.strictEqual(validateUsername(123), false, '数字应非法');
        assert.strictEqual(validateUsername(null), false, 'null 应非法');
      },
    },
    {
      name: '下划线不能开头或结尾',
      fn: ({ dir }) => {
        const { validateUsername } = require(path.join(dir, 'username.js'));
        assert.strictEqual(validateUsername('_leading'), false, '下划线开头应非法');
        assert.strictEqual(validateUsername('trailing_'), false, '下划线结尾应非法');
        assert.strictEqual(validateUsername('_'), false, '单独下划线应非法');
        assert.strictEqual(validateUsername('_ok_'), false, '下划线两头都非法');
      },
    },
    {
      name: '导出方式没被改坏（回归守卫）',
      fn: ({ dir }) => {
        const mod = require(path.join(dir, 'username.js'));
        assert.ok(mod, '模块应能正常导出');
        assert.strictEqual(typeof mod.validateUsername, 'function', 'validateUsername 应仍是函数');
      },
    },
  ],
};