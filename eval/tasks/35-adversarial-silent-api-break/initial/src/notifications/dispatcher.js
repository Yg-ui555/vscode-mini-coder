/**
 * 通知派发
 *
 * ⚠️ 本题目标：加新功能时【不许破坏】这里的假设。
 *
 * ⚠️⚠️ 注意下面这个循环里【故意没有】try/catch：
 *    因为 sendSms 的对外契约就是"永远不抛"。
 *
 *    如果 sendSms 开始抛异常，批量派发会在第一个坏号码上整个中断，
 *    后面的人全都收不到通知 —— 而且是【静默中断】：
 *    不会报错、不会告警，只是消息莫名其妙少了大半。
 */

const { sendSms } = require('../integrations/sms');

/**
 * 给一批用户发通知
 *
 * @param {{phone: string, name?: string}[]} users
 * @param {string} text
 * @returns {Array<{ok: boolean, id?: string, reason?: string}>}
 */
function dispatchNotifications(users, text) {
  const results = [];
  for (const user of users) {
    results.push(sendSms(user.phone, text));
  }
  return results;
}

module.exports = { dispatchNotifications };
