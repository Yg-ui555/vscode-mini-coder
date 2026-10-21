/**
 * 验收脚本 —— 05-simple-parse-config
 * 判定是二值的：断言全过 or 有挂
 */

const assert = require('assert');
const path = require('path');

module.exports = {
  taskId: '05-simple-parse-config',

  cases: [
    {
      name: '基本解析：key / value 两边 trim（回归守卫）',
      fn: ({ dir }) => {
        const { parseConfig } = require(path.join(dir, 'config.js'));
        assert.deepStrictEqual(
          parseConfig('name = wxu\n   port   =   8080   '),
          { name: 'wxu', port: '8080' },
          '正常的 key=value 应原样解析出来',
        );
        assert.deepStrictEqual(parseConfig('a=1\nb=2'), { a: '1', b: '2' }, '等号两边无空格也应能解析');
      },
    },
    {
      name: '注释行被跳过（被注释掉的配置不能进结果）',
      fn: ({ dir }) => {
        const { parseConfig } = require(path.join(dir, 'config.js'));
        assert.deepStrictEqual(
          parseConfig('# port = 3306\nport = 8080'),
          { port: '8080' },
          '注释掉的旧配置不能进结果',
        );
        assert.deepStrictEqual(
          parseConfig('# 这是注释\nname = wxu\n#another\nport = 8080'),
          { name: 'wxu', port: '8080' },
          '不带 = 的注释行也应被跳过',
        );
      },
    },
    {
      name: '带缩进的注释行也要跳过',
      fn: ({ dir }) => {
        const { parseConfig } = require(path.join(dir, 'config.js'));
        assert.deepStrictEqual(
          parseConfig('name = wxu\n    # port = 3306\nport = 8080'),
          { name: 'wxu', port: '8080' },
          '先 trim 再判断 #，缩进注释同样要跳过',
        );
      },
    },
    {
      name: '回归守卫：值里的 = 和 # 不能被误切',
      fn: ({ dir }) => {
        const { parseConfig } = require(path.join(dir, 'config.js'));
        assert.deepStrictEqual(
          parseConfig('cmd = a=b=c'),
          { cmd: 'a=b=c' },
          '值里有 = 时只按第一个 = 分割',
        );
        assert.deepStrictEqual(
          parseConfig('color = #ff0000'),
          { color: '#ff0000' },
          '值里的 # 不是注释，要原样保留',
        );
      },
    },
    {
      name: '回归守卫：空输入 / 纯空行 / 没有 = 的行',
      fn: ({ dir }) => {
        const { parseConfig } = require(path.join(dir, 'config.js'));
        assert.deepStrictEqual(parseConfig(''), {}, '空字符串应返回 {}');
        assert.deepStrictEqual(parseConfig('\n\n   \n'), {}, '纯空行应返回 {}');
        assert.deepStrictEqual(
          parseConfig('just a line\nname = wxu'),
          { name: 'wxu' },
          '没有 = 的行应继续跳过，不产生 key',
        );
      },
    },
    {
      name: '非法输入返回 {} 且不抛异常',
      fn: ({ dir }) => {
        const { parseConfig } = require(path.join(dir, 'config.js'));
        assert.doesNotThrow(() => parseConfig(null), '传 null 不应抛异常');
        assert.doesNotThrow(() => parseConfig(undefined), '传 undefined 不应抛异常');
        assert.deepStrictEqual(parseConfig(null), {}, '传 null 应返回 {}');
        assert.deepStrictEqual(parseConfig(undefined), {}, '传 undefined 应返回 {}');
      },
    },
    {
      name: '回归守卫 + 副作用守卫：getConfigValue 默认值机制与导出没被改坏',
      fn: ({ dir }) => {
        const mod = require(path.join(dir, 'config.js'));
        assert.ok(mod, '模块应能正常导出');
        assert.strictEqual(typeof mod.parseConfig, 'function', 'parseConfig 应仍是函数');
        assert.strictEqual(typeof mod.getConfigValue, 'function', 'getConfigValue 应仍是函数');

        const { getConfigValue } = mod;
        assert.strictEqual(
          getConfigValue('name = wxu\nport = 8080', 'name', 'x'),
          'wxu',
          '存在的 key 应返回配置里的值',
        );
        assert.strictEqual(
          getConfigValue('name = wxu', 'missing', '默认值'),
          '默认值',
          '不存在的 key 应返回默认值',
        );
        assert.strictEqual(
          getConfigValue('# name = fake\nname = real', 'name', 'x'),
          'real',
          '注释掉的值不能盖掉真实配置',
        );
        assert.strictEqual(
          getConfigValue('name = ', 'name', 'fallback'),
          '',
          '空字符串是有效值，不该被当成缺失',
        );
      },
    },
  ],
};