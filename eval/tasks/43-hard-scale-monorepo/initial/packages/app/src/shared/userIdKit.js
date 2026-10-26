/**
 * 用户 ID 工具。
 *
 * ⚠️ 名字跟 formatUser 长得像，但完全不是一回事 ——
 *    它只拼 ID，从来不渲染用户名。
 */
const { formatUserId } = require('../../../core/src/user/formatId');

/** 给用户生成展示用的 ID 标签 */
function formatUserTag(user) {
  const name = String((user && user.name) || '').toLowerCase().replace(/[^a-z0-9]+/g, '.');
  return name + '@example.com';
}

/** 直接透传 core 的 ID 格式化 */
function id(user) {
  return formatUserId(user);
}

module.exports = { formatUserTag, id };
