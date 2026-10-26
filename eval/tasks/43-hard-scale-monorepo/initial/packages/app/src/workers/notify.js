/**
 * 通知下发（⭐ 参数是变参转发的）
 */
const { formatUser } = require('../../../core/src/user/format');

/**
 * ⭐ 通知文案要支持任意参数，所以这里做了一层变参转发。
 */
function formatUserForNotification(...args) {
  return formatUser(...args);
}

/** 渲染一行 */
function render(user) {
  return formatUserForNotification(user, 'compact');
}

module.exports = { render };
