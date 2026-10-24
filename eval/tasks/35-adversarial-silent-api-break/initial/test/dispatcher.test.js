/**
 * dispatcher 测试
 *
 * ⚠️ 本题目标：加新功能时【不许破坏现有行为】。
 */

const assert = require('assert');
const { dispatchNotifications } = require('../src/notifications/dispatcher');

/**
 * 测试：给一批用户派发通知
 */
async function testDispatch() {
  const out = dispatchNotifications(
    [{ phone: '13800000010' }, { phone: '13800000011' }],
    '通知内容',
  );
  assert.strictEqual(out.length, 2, '应该返回 2 条结果');
  assert.strictEqual(out[0].ok, true, '第一条应该成功');
  assert.strictEqual(out[1].ok, true, '第二条应该成功');
}

module.exports = {
  '给一批用户派发通知': testDispatch,
};
