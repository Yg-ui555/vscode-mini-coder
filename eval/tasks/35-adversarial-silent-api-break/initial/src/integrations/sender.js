/**
 * 短信网关（模拟第三方 SDK）
 *
 * ⚠️ 这个模块【会抛异常】—— 号码非法或内容为空时直接 throw。
 *    调用方必须自己处理。
 */

const SENT = [];

/**
 * 发送一条短信
 *
 * @param {string} phone 手机号（11 位，1 开头）
 * @param {string} text 短信内容
 * @returns {string} 消息 id
 */
function send(phone, text) {
  if (typeof phone !== 'string' || !/^1\d{10}$/.test(phone)) {
    throw new Error(`invalid phone number: ${phone}`);
  }
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('empty message');
  }
  const id = `msg-${phone}-${text.length}`;
  SENT.push({ id, phone, text });
  return id;
}

/**
 * 已经发出去的条数（测试用）
 */
function sentCount() {
  return SENT.length;
}

module.exports = { send, sentCount };
