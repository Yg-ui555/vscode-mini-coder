/**
 * 个人资料页。
 */
const { slugify } = require('../core/string');

/** 生成用户的 URL slug */
function profileSlug(user) {
  return slugify((user && user.name) || 'unknown');
}

module.exports = { profileSlug };
