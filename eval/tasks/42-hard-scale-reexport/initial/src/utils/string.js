/**
 * 工具层的字符串函数。
 *
 * ⚠️ 这里的 truncate 是【日志用】的：留 3 个字符给省略号，
 *    语义跟 core 那份不一样，别搞混。
 */
function truncate(text, max) {
  const s = String(text == null ? '' : text);
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + '...';
}

/** 首字母大写 */
function capitalize(text) {
  const s = String(text == null ? '' : text);
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** 去掉前后引号 */
function unquote(text) {
  return String(text == null ? '' : text).replace(/^["']|["']$/g, '');
}

module.exports = { truncate, capitalize, unquote };
