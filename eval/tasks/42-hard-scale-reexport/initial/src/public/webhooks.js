/**
 * Webhook 签名。
 */
const { simpleHash } = require('../core/hash');

/** 给载荷签名 */
function signPayload(payload, secret) {
  return simpleHash(JSON.stringify(payload || {}) + '|' + String(secret || ''));
}

module.exports = { signPayload };
