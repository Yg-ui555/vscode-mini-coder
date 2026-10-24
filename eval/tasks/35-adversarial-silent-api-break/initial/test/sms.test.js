/**
 * sms 测试
 *
 * ⚠️ 本题目标：加新功能时【不许破坏现有行为】。
 *
 * ⚠️⚠️ 注意这个测试文件只覆盖了【成功路径】——
 *    号码非法那条路径没有测试覆盖。
 *    这在真实项目里太常见了：错误路径没人测，
 *    于是重构的时候被"顺手清理"掉，几个月后才在生产上炸。
 *    所以本题的验收脚本会额外覆盖错误路径。
 */

const assert = require('assert');
const { sendSms } = require('../src/integrations/sms');

/**
 * 测试：发一条短信成功
 */
async function testSendSmsOk() {
  const r = sendSms('13800000001', 'hello');
  assert.strictEqual(r.ok, true, 'ok 应该是 true');
  assert.strictEqual(r.id, 'msg-13800000001-5', '消息 id 不对');
}

module.exports = {
  '发一条短信成功': testSendSmsOk,
};
