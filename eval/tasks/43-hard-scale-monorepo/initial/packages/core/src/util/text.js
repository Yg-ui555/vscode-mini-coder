/**
 * 文本工具。
 */

/** 词数 */
function wordCount(text) {
  return String(text == null ? '' : text).split(/\s+/).filter(Boolean).length;
}

/** 压缩空白 */
function normalizeSpace(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

/** 截断 */
function clip(text, max) {
  const s = String(text == null ? '' : text);
  return s.length > max ? s.slice(0, max) : s;
}

module.exports = { wordCount, normalizeSpace, clip };
