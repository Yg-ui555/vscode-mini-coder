/**
 * 文本工具。
 */

/** 首字母大写 */
function capitalize(s) {
  const t = String(s == null ? '' : s);
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** 截断到指定长度（按字符） */
function clip(s, max) {
  const t = String(s == null ? '' : s);
  return t.length > max ? t.slice(0, max) : t;
}

/** 统计非空白字符数 */
function countNonSpace(s) {
  return String(s == null ? '' : s).replace(/\s/g, '').length;
}

/** slug 化 */
function slug(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { capitalize, clip, countNonSpace, slug };
