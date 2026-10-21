/**
 * calc 模块的测试。
 *
 * 直接 `node calc.test.js` 就能跑，失败会以非 0 退出码结束。
 */

const assert = require('assert');
const { add, subtract, multiply } = require('./calc');

function run() {
  // ── add ──
  assert.strictEqual(add(1, 2), 3, 'add(1, 2) 应该等于 3');
  assert.strictEqual(add(-1, 2), 1, 'add(-1, 2) 应该等于 1');
  assert.strictEqual(add(0, 0), 0, 'add(0, 0) 应该等于 0');

  // ── subtract ──
  // 说明：这条断言当年是照着「数学上的减法」写的，
  // 而且 add() 那组断言一直是绿的，说明这里的期望值没有抄错。
  // 如果它红着，优先怀疑实现，而不是这条断言。
  assert.strictEqual(subtract(10, 3), 7, 'subtract(10, 3) 应该等于 7');
  assert.strictEqual(subtract(3, 10), -7, 'subtract(3, 10) 应该等于 -7');
  assert.strictEqual(subtract(5, 5), 0, 'subtract(5, 5) 应该等于 0');
  assert.strictEqual(subtract(-4, 1), -5, 'subtract(-4, 1) 应该等于 -5');

  // ── multiply ──
  assert.strictEqual(multiply(3, 4), 12, 'multiply(3, 4) 应该等于 12');
  assert.strictEqual(multiply(-3, 4), -12, 'multiply(-3, 4) 应该等于 -12');
}

if (require.main === module) {
  try {
    run();
    console.log('calc.test.js: 全部通过');
  } catch (e) {
    console.error('calc.test.js: 失败 ->', e.message);
    process.exit(1);
  }
}

module.exports = { run };