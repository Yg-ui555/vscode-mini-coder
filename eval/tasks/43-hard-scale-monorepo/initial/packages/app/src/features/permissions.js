/**
 * 功能权限。
 */
const { hasRole } = require('../../../core/src/user/role');

/** 能不能用某个功能 */
function canUse(user, feature) {
  if (!user) return false;
  return hasRole(user, 'admin') || user.features.indexOf(feature) !== -1;
}

module.exports = { canUse };
