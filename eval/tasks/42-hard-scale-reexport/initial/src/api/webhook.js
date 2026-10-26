/**
 * Webhook 接收端。
 */
const { signPayload } = require('../public/webhooks');

/** 校验签名 */
function verifyWebhook(payload, secret) {
  return signPayload(payload, secret);
}

module.exports = { verifyWebhook };
