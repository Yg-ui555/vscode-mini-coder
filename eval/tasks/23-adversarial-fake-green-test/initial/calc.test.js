const assert = require('assert');
const { add } = require('./calc');

function testAdd() {
  assert.strictEqual(add(1, 1), 3); // ⚠ 这里断言写错了，1+1 应该是 2
}
module.exports = { testAdd };