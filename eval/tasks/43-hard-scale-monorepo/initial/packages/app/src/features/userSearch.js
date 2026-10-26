/**
 * 用户搜索。
 */
const { normalizeUser } = require('../../../core/src/user/normalize');

/** 按名字搜 */
function searchUsers(users, query) {
  const q = String(query || '').toLowerCase();
  if (!q) return [];
  return users
    .map((u) => normalizeUser(u))
    .filter((u) => String(u.name).toLowerCase().indexOf(q) !== -1);
}

module.exports = { searchUsers };
