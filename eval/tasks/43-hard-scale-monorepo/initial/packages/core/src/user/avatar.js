/**
 * 头像地址。
 */
const { simpleHash } = require('../util/hash');

/** 由用户 id 派生一个头像地址 */
function avatarUrl(user) {
  const id = (user && user.id) || 0;
  return '/avatars/' + simpleHash('avatar:' + id) + '.png';
}

module.exports = { avatarUrl };
