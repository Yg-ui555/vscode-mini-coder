/**
 * DOM 相关的字符串处理（不碰真实 DOM，纯文本）。
 */

/** 转义 HTML */
function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 属性值转义 */
function escapeAttr(text) {
  return escapeHtml(text).replace(/'/g, '&#39;');
}

module.exports = { escapeHtml, escapeAttr };
