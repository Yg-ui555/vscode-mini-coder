/**
 * 验收脚本 —— 边界条件解析器
 *
 * 判定要点：
 *   1. 解码 / 重复 key / 裸 flag / 中文与畸形转义（baseline 挂）
 *   2. 空片段、空 key、常规单参数行为（回归守卫，baseline 过）
 *   3. 另外四个导出函数必须原封不动（副作用守卫，baseline 过）
 */

const assert = require('assert');
const path = require('path');

const load = (dir) => require(path.join(dir, 'parser.js'));

module.exports = {
  taskId: '12-hard-edge-parser',

  cases: [
    {
      // ⭐ baseline 挂
      name: 'URL 解码：%20 与 + 都要变成空格',
      fn: ({ dir }) => {
        const { parseQuery } = load(dir);

        assert.deepStrictEqual(
          parseQuery('name=John%20Doe'),
          { name: 'John Doe' },
          '%20 应解码成空格'
        );
        assert.deepStrictEqual(
          parseQuery('q=hello+world'),
          { q: 'hello world' },
          '+ 应解码成空格'
        );
        assert.deepStrictEqual(
          parseQuery('msg=a+b%20c'),
          { msg: 'a b c' },
          '%20 和 + 可以混用'
        );
        // key 也要解码
        assert.deepStrictEqual(
          parseQuery('full%20name=%E5%BC%A0%E4%B8%89'),
          { 'full name': '张三' },
          'key 也要做解码'
        );
        // %2B 是字面量的加号，不能被当成空格（验证解码顺序）
        assert.deepStrictEqual(
          parseQuery('sym=a%2Bb'),
          { sym: 'a+b' },
          '%2B 应解成字面量 +，不能变空格'
        );
        // 多个空格
        assert.deepStrictEqual(
          parseQuery('t=%20%20x%20'),
          { t: '  x ' },
          '连续 %20 应解成多个空格'
        );
      },
    },

    {
      // ⭐ baseline 挂
      name: '重复 key 收集成数组并保持出现顺序',
      fn: ({ dir }) => {
        const { parseQuery } = load(dir);

        assert.deepStrictEqual(
          parseQuery('a=1&a=2'),
          { a: ['1', '2'] },
          '重复 key 应收集成数组'
        );
        assert.deepStrictEqual(
          parseQuery('a=1&a=2&a=3'),
          { a: ['1', '2', '3'] },
          '三次重复应收集成三个元素的数组'
        );
        assert.deepStrictEqual(
          parseQuery('x=0&a=1&b=2&a=3'),
          { x: '0', a: ['1', '3'], b: '2' },
          '重复 key 之间的其他 key 不受影响'
        );
        // 空 key 重复时同样要合并成数组
        assert.deepStrictEqual(
          parseQuery('=5&=6'),
          { '': ['5', '6'] },
          '两个空 key 应合并成数组'
        );
        // 只出现一次仍然是字符串
        assert.deepStrictEqual(
          parseQuery('a=1&b=2'),
          { a: '1', b: '2' },
          '没重复的 key 仍应是字符串，不是数组'
        );
        assert.strictEqual(
          Array.isArray(parseQuery('a=1&b=2').a),
          false,
          '只出现一次的 key 不能变成数组'
        );
      },
    },

    {
      // ⭐ baseline 挂
      name: '裸 flag（无 = 的片段）保留成 null',
      fn: ({ dir }) => {
        const { parseQuery } = load(dir);

        assert.deepStrictEqual(
          parseQuery('flag&a=1'),
          { flag: null, a: '1' },
          '裸 flag 应保留为 null'
        );
        assert.deepStrictEqual(parseQuery('a'), { a: null }, '单个裸 flag 应保留');
        assert.deepStrictEqual(
          parseQuery('debug&verbose'),
          { debug: null, verbose: null },
          '多个裸 flag 都应保留'
        );
        assert.ok(
          'flag' in parseQuery('flag&a=1'),
          'flag 必须作为 key 存在，不能被丢掉'
        );
        assert.strictEqual(
          parseQuery('flag&a=1').flag,
          null,
          '裸 flag 的值必须是 null（严格相等，不是 undefined）'
        );
        // 裸 flag 和同 key 的赋值片段混在一起 -> 并进数组
        assert.deepStrictEqual(
          parseQuery('a=1&a'),
          { a: ['1', null] },
          'a=1&a 应为 ["1", null]'
        );
        assert.deepStrictEqual(
          parseQuery('a&a=1'),
          { a: [null, '1'] },
          'a&a=1 应为 [null, "1"]'
        );
        // 裸 flag 的值也要解码
        assert.deepStrictEqual(
          parseQuery('my%20flag'),
          { 'my flag': null },
          '裸 flag 的 key 也要解码'
        );
      },
    },

    {
      // ⭐ baseline 挂
      name: '中文转义正确解码，畸形转义不抛异常且保留原样',
      fn: ({ dir }) => {
        const { parseQuery } = load(dir);

        assert.deepStrictEqual(
          parseQuery('name=%E4%B8%AD'),
          { name: '中' },
          '%E4%B8%AD 应解码成「中」'
        );
        assert.deepStrictEqual(
          parseQuery('name=%E4%B8%AD%E6%96%87'),
          { name: '中文' },
          '多字节中文应正确解码'
        );

        // 畸形转义：decodeURIComponent 会抛 URIError，必须兜住
        let res;
        assert.doesNotThrow(
          () => {
            res = parseQuery('a=%E4');
          },
          '畸形百分号序列不应抛异常'
        );
        assert.deepStrictEqual(
          res,
          { a: '%E4' },
          '畸形转义应保留原始字符串'
        );
        assert.doesNotThrow(() => parseQuery('a=%'), '单个 % 不应抛异常');
        assert.doesNotThrow(() => parseQuery('a=%%20'), '%%20 不应抛异常');
        assert.deepStrictEqual(parseQuery('a=100%'), { a: '100%' }, '裸 % 应原样保留');
        assert.deepStrictEqual(parseQuery('k%=%E4'), { 'k%': '%E4' }, '畸形 key 也应保留原样');
      },
    },

    {
      // 回归守卫：空片段必须跳过（baseline 就过）
      name: '【回归】空片段跳过，不产生空 key',
      fn: ({ dir }) => {
        const { parseQuery } = load(dir);

        assert.deepStrictEqual(parseQuery('a=1&'), { a: '1' }, '末尾 & 应被跳过');
        assert.deepStrictEqual(parseQuery('&a=1'), { a: '1' }, '开头 & 应被跳过');
        assert.deepStrictEqual(parseQuery('a=1&&b=2'), { a: '1', b: '2' }, '连续 && 应被跳过');
        assert.deepStrictEqual(parseQuery('&&&'), {}, '全是 & 应返回 {}');
        assert.deepStrictEqual(parseQuery('&'), {}, '单个 & 应返回 {}');
        assert.deepStrictEqual(parseQuery('='), { '': '' }, '单独一个 = 应是空 key 空 value');

        // 关键：不能出现空字符串 key
        for (const input of ['a=1&', '&&&', '&&a=1&&']) {
          assert.ok(
            !('' in parseQuery(input)),
            `输入 "${input}" 不应该产生空字符串 key`
          );
        }
      },
    },

    {
      // 回归守卫：空 key 与常规入参（baseline 就过）
      name: '【回归】空 key / 空串 / 非字符串入参',
      fn: ({ dir }) => {
        const { parseQuery } = load(dir);

        assert.deepStrictEqual(parseQuery('=5'), { '': '5' }, '空 key 应正常解析');

        assert.deepStrictEqual(parseQuery(''), {}, '空串应返回 {}');
        assert.deepStrictEqual(parseQuery(null), {}, 'null 应返回 {}');
        assert.deepStrictEqual(parseQuery(undefined), {}, 'undefined 应返回 {}');
        assert.deepStrictEqual(parseQuery(0), {}, '0 应返回 {}');

        // 这些都不能抛异常
        assert.doesNotThrow(() => parseQuery('a=1'), '正常输入不应抛异常');
        assert.doesNotThrow(() => parseQuery('!!!'), '纯符号不应抛异常');
      },
    },

    {
      // 回归守卫：已有正确行为不变（baseline 就过）
      name: '【回归】单参数正常解析行为不变',
      fn: ({ dir }) => {
        const { parseQuery } = load(dir);

        assert.deepStrictEqual(parseQuery('a=1'), { a: '1' }, 'a=1 应原样');
        assert.deepStrictEqual(parseQuery('a=1&b=2'), { a: '1', b: '2' }, '两个参数应原样');
        assert.deepStrictEqual(
          parseQuery('page=2&size=20&keyword=ai'),
          { page: '2', size: '20', keyword: 'ai' },
          '多参数应原样'
        );
        // value 里的 = 不能被拆开（只按第一个 = 分）
        assert.deepStrictEqual(
          parseQuery('token=a=b=c'),
          { token: 'a=b=c' },
          'value 里的 = 应保留'
        );
        // key 顺序要保持插入顺序
        assert.deepStrictEqual(
          Object.keys(parseQuery('z=1&a=2&m=3')),
          ['z', 'a', 'm'],
          'key 的插入顺序不能变'
        );
        // 未转义的普通值原样透传
        assert.deepStrictEqual(parseQuery('name=John'), { name: 'John' }, '普通值应原样');
      },
    },

    {
      // 副作用守卫：另外四个函数不许被改（baseline 就过）
      name: '【副作用】其余四个导出函数行为没变',
      fn: ({ dir }) => {
        const mod = load(dir);

        assert.deepStrictEqual(
          Object.keys(mod).sort(),
          ['countPairs', 'parseQuery', 'parseQuerySafely', 'splitPairs', 'stringifyQuery'],
          '导出表不能增删'
        );

        // stringifyQuery
        assert.strictEqual(mod.stringifyQuery({ a: 1, b: 'x y' }), 'a=1&b=x%20y', 'stringifyQuery 基本行为变了');
        assert.strictEqual(mod.stringifyQuery({ a: [1, 2] }), 'a=1&a=2', '数组值应展开成重复 key');
        assert.strictEqual(mod.stringifyQuery({ a: null, b: undefined, c: 1 }), 'c=1', 'null/undefined 应跳过');
        assert.strictEqual(mod.stringifyQuery(null), '', 'null 应返回空串');
        assert.strictEqual(mod.stringifyQuery({}), '', '空对象应返回空串');
        assert.strictEqual(mod.stringifyQuery({ '名 字': '值' }), '%E5%90%8D%20%E5%AD%97=%E5%80%BC', '中文应被编码');

        // countPairs
        assert.strictEqual(mod.countPairs('a=1&b=2'), 2, 'countPairs 基本行为变了');
        assert.strictEqual(mod.countPairs('a=1&b=2&a=3'), 3, '重复 key 也要计数');
        assert.strictEqual(mod.countPairs('flag&a=1'), 1, '裸 flag 不该计数');
        assert.strictEqual(mod.countPairs('a=1&&'), 1, '空片段不该计数');
        assert.strictEqual(mod.countPairs(''), 0, '空串应返回 0');
        assert.strictEqual(mod.countPairs(null), 0, 'null 应返回 0');
        assert.strictEqual(mod.countPairs('=5'), 1, '空 key 也算一个 pair');

        // splitPairs
        assert.deepStrictEqual(mod.splitPairs('a=1&b=2'), ['a=1', 'b=2'], 'splitPairs 基本行为变了');
        assert.deepStrictEqual(mod.splitPairs('a=1&&b=2'), ['a=1', 'b=2'], '空片段应被过滤');
        assert.deepStrictEqual(mod.splitPairs(''), [], '空串应返回 []');
        assert.deepStrictEqual(mod.splitPairs(null), [], 'null 应返回 []');
        assert.deepStrictEqual(mod.splitPairs('flag'), ['flag'], '裸 flag 是非空片段应保留');

        // parseQuerySafely
        assert.deepStrictEqual(mod.parseQuerySafely('a=1'), { a: '1' }, '正常输入应透传');
        assert.deepStrictEqual(mod.parseQuerySafely(''), {}, '空串应返回 {}');
        assert.doesNotThrow(() => mod.parseQuerySafely('a=%E4'), '畸形输入不应抛异常');
        assert.deepStrictEqual(
          mod.parseQuerySafely('a=%E4'),
          { a: '%E4' },
          'parseQuerySafely 应透传解析结果'
        );
      },
    },
  ],
};