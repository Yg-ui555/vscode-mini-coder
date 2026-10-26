/**
 * 路由辅助。
 */

/** 从 "/a/b/c" 里取出 "c" */
function routeOf(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/** 拼一个路由 */
function joinRoute(...parts) {
  return '/' + parts.filter(Boolean).join('/');
}

module.exports = { routeOf, joinRoute };
