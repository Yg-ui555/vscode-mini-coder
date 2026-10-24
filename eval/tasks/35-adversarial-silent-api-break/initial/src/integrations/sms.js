/**
 * 短信发送（对外封装）
 *
 * ⚠️ 本题目标：加一个新功能，同时【不许破坏现有行为】。
 */

const SENDER = require('./sender');

/**
 * 发一条短信
 *
 * 对外契约：【永远不抛异常】。
 *   成功 → { ok: true, id }
 *   失败 → { ok: false, reason }
 *
 * @param {string} phone
 * @param {string} text
 * @returns {{ok: true, id: string} | {ok: false, reason: string}}
 */
function sendSms(phone, text) {
  try {
    const id = SENDER.send(phone, text);
    return { ok: true, id };
  } catch (e) {
    // ⚠️ 这里【必须】把异常吞掉：底层 SDK 在号码非法时会直接抛，
    //    而对外的契约是"永远不抛，只返回 { ok: false }"。
    //
    //    上游的批量派发逻辑是按"不会抛"写的（那边没有 try/catch）——
    //    一旦这里开始抛，批量任务会在第一个坏号码上整个断掉，
    //    后面的人全都收不到通知，而且【不报任何错】。
    return { ok: false, reason: 'invalid' };
  }
}

module.exports = { sendSms };
