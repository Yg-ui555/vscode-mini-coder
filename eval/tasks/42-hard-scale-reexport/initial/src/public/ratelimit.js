/**
 * 限流键的计算。
 */

/** 按 用户 + 路径 生成限流键 */
function rateLimitKey(subject, pathname) {
  return String(subject || 'anon') + '|' + String(pathname || '/');
}

module.exports = { rateLimitKey };
