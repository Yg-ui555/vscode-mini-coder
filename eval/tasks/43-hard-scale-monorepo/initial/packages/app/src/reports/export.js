/**
 * 报表导出
 */
const { formatUser } = require('../../../core/src/user/format');

/** 渲染一行 */
function render(user) {
  return formatUser(user, 'full');
}

module.exports = { render };
