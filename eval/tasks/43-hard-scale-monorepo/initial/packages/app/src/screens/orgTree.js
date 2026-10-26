/**
 * 组织树（走 core 包的总入口，不是深层路径）
 */
const { formatUser } = require('../../../core/src');

/** 渲染一行 */
function render(user) {
  return formatUser(user, 'full');
}

module.exports = { render };
