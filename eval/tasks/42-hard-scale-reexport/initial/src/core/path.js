/**
 * 路径工具（只处理 POSIX 风格的相对路径，跟平台无关）。
 */

/** 拼接路径 */
function joinPath(...parts) {
  return parts
    .filter((p) => p !== undefined && p !== null && p !== '')
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '');
}

/** 扩展名（含点） */
function extname(p) {
  const s = String(p || '');
  const base = s.slice(s.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i);
}

/** 文件名 */
function basename(p) {
  const s = String(p || '');
  return s.slice(s.lastIndexOf('/') + 1);
}

/** 目录名 */
function dirname(p) {
  const s = String(p || '');
  const i = s.lastIndexOf('/');
  return i <= 0 ? '' : s.slice(0, i);
}

module.exports = { joinPath, extname, basename, dirname };
