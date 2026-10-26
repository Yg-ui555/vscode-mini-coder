/**
 * 标签工具集（⭐ style 有默认值）
 */
const { formatUser } = require('../../../core/src/user/format');

/** 渲染一行 */
function renderLabel(user, style = 'full') {
  return formatUser(user, style);
}

module.exports = { renderLabel };
