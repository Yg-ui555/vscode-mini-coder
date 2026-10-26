/**
 * 用户格式化适配层（⭐ style 是外部传进来的）
 */
const { formatUser } = require('../../../core/src/user/format');

/** 渲染一行 */
function formatUserFor(user, style) {
  return formatUser(user, style);
}

module.exports = { formatUserFor };
