/** app 模块的测试。`node app.test.js` 直接跑。 */

const assert = require('assert');
const { parseConfig, renderConfig, get } = require('./app');

function run() {
  // ── 正常路径：每行都有 = ──
  assert.deepStrictEqual(parseConfig('A=1\nB=2'), { A: '1', B: '2' }, '标准 KEY=value 应该正常解析');
  assert.deepStrictEqual(parseConfig('A='), { A: '' }, '空值应该保留空串');
  assert.deepStrictEqual(parseConfig(''), {}, '空输入应该得到空对象');
  assert.deepStrictEqual(parseConfig('\n\n'), {}, '全是空行应该得到空对象');

  // ── 混合输入：一行合法的 + 一行不合法的 ──
  // 合法的照常解析，不合法的整行跳过，不允许产出任何多余键
  assert.deepStrictEqual(
    parseConfig('A=1\nVERBOSE\nB=2'),
    { A: '1', B: '2' },
    '不含 = 的行应该整行跳过，不能产出 VERBOS 之类的垃圾键'
  );

  // ── 等号两侧的空格 ──
  assert.deepStrictEqual(parseConfig(' A = 1 '), { A: '1' }, '等号两侧的空格应该去掉');

  // ── renderConfig ──
  assert.strictEqual(renderConfig({ A: '1', B: '2' }), 'A=1\nB=2', 'renderConfig 输出格式不能变');
  assert.strictEqual(renderConfig({}), '', '空 map 渲染成空串');

  // ── get ──
  assert.strictEqual(get({ A: '1' }, 'A', 'x'), '1');
  assert.strictEqual(get({ A: '1' }, 'B', 'x'), 'x', '缺键要返回 fallback');
  assert.strictEqual(get({ A: undefined }, 'A', 'x'), undefined, '键存在但值为 undefined 时不该返回 fallback');
}

if (require.main === module) {
  try {
    run();
    console.log('app.test.js: 全部通过');
  } catch (e) {
    console.error('app.test.js: 失败 ->', e.message);
    process.exit(1);
  }
}

module.exports = { run };