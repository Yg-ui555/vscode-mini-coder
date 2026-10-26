/**
 * 用户 ID 格式化。
 *
 * ⚠️ 只拼 ID，不渲染名字 —— 名字长得像 formatUser，但完全是两回事。
 */
function formatUserId(user) {
  const id = (user && user.id) || 0;
  return 'U-' + id;
}

module.exports = { formatUserId };
