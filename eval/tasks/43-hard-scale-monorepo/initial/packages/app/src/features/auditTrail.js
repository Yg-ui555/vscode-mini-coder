/**
 * 审计流水
 */
const { formatUser } = require('../../../core/src/user/format');

/** 渲染一行 */
function render(user) {
  return formatUser(user);
}

module.exports = { render };
