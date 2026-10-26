/**
 * 简单哈希。
 */

/** djb2 变体 */
function simpleHash(s) {
  const str = String(s == null ? '' : s);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

module.exports = { simpleHash };
