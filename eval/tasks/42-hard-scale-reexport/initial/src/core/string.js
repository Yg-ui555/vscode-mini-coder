/**
 * 字符串工具 —— 仓库里【唯一】一份按【字符】截断的实现。
 *
 * ⚠️ 这里的 truncate 是对外 API 的正确语义：
 *    按字符（不是字节）截断，超长时补一个省略号。
 */
function truncate(text, max) {
  const s = String(text == null ? '' : text);
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

/** 左侧补齐 */
function padStart(text, width, fill) {
  const s = String(text == null ? '' : text);
  const f = fill === undefined ? ' ' : String(fill);
  let out = s;
  while (out.length < width) out = f + out;
  return out;
}

/** slug 化 */
function slugify(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 首字母大写 */
function capitalize(text) {
  const s = String(text == null ? '' : text);
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** 去首尾空白 */
function trim(text) {
  return String(text == null ? '' : text).trim();
}

/** 重复字符串 */
function repeat(text, times) {
  return String(text == null ? '' : text).repeat(Math.max(0, times | 0));
}

module.exports = { truncate, padStart, slugify, capitalize, trim, repeat };
