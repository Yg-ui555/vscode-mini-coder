/**
 * 账号中心的个人资料展示格式化。
 *
 * ⚠️ 注意：这个文件和 src/services/audit/format.js 同名，
 *   而且都导出一个叫 displayName 的函数，但两者契约完全不同：
 *     - 本文件处理【用户对象】，有 name 和 handle 两个字段
 *     - audit 那份处理【审计记录】，只有 actor 一个字段
 *   改错文件的话，profile 页面的 bug 一点都不会消失。
 */

const ANONYMOUS = 'anonymous';

function displayName(user) {
  if (!user) return ANONYMOUS;
  const n = typeof user.name === 'string' ? user.name.trim() : '';
  return n;
}

function initials(user) {
  const name = displayName(user);
  if (name === ANONYMOUS) return '?';
  return name.slice(0, 1).toUpperCase();
}

function profileLine(user) {
  return displayName(user) + ' (' + user.handle + ')';
}

module.exports = { ANONYMOUS, displayName, initials, profileLine };