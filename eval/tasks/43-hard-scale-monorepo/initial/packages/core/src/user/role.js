/**
 * 角色判断。
 */
const ROLES = ['admin', 'editor', 'viewer'];

/** 有没有某个角色 */
function hasRole(user, role) {
  if (!user || !Array.isArray(user.roles)) return false;
  return user.roles.indexOf(role) !== -1;
}

/** 全部角色 */
function listRoles() {
  return ROLES.slice();
}

module.exports = { hasRole, listRoles };
