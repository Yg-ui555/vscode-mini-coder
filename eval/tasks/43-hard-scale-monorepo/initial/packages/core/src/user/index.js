/**
 * 用户相关能力的汇总。
 */
const format = require('./format');
const formatId = require('./formatId');
const normalize = require('./normalize');
const avatar = require('./avatar');
const role = require('./role');

module.exports = {
  formatUser: format.formatUser,
  formatUsername: format.formatUsername,
  formatUserId: formatId.formatUserId,
  normalizeUser: normalize.normalizeUser,
  avatarUrl: avatar.avatarUrl,
  hasRole: role.hasRole,
  listRoles: role.listRoles,
};
