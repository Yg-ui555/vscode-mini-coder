/**
 * 悬浮提示。
 */
const { escapeRegExp } = require('../core/regex');

/** 高亮关键词 */
function highlight(text, keyword) {
  if (!keyword) return String(text == null ? '' : text);
  const re = new RegExp('(' + escapeRegExp(keyword) + ')', 'gi');
  return String(text == null ? '' : text).replace(re, '<em>$1</em>');
}

module.exports = { highlight };
