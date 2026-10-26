/**
 * 用户显示名的统一格式化。
 *
 * 全仓库都靠它把用户对象渲染成显示串：
 *   { id: 42, name: '张三', email: 'zhang@example.com' }
 *   -> "张三 <zhang@example.com> (#42)"
 */

/**
 * @param {{id: number, name: string, email?: string}} user
 * @returns {string}
 */
function formatUserId(user) {
  if (!user) return 'unknown';
  const mail = user.email ? ` <${user.email}>` : '';
  return `${user.name}${mail} (#${user.id})`;
}

module.exports = { formatUserId };
