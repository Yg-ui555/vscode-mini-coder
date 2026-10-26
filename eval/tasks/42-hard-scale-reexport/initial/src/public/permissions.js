/**
 * 权限判断。
 */

/**
 * 判断当前主体能不能做某个动作。
 *
 * @param {string[]} grants 主体拥有的权限
 * @param {string}   action  要做的动作
 */
function can(grants, action) {
  return (grants || []).includes(action);
}

module.exports = { can };
