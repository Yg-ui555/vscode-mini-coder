/**
 * 正则工具。
 */

/** 转义正则元字符 */
function escapeRegExp(s) {
  return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 找出所有匹配（返回数组，不带 lastIndex 状态）。
 *
 * ⚠️ 不用带 /g 的全局正则做 exec 循环 ——
 *   全局正则有 lastIndex 状态，复用同一个正则对象会让第二次调用结果为空。
 *   这里每次都新建正则，牺牲一点性能换掉一整类难查的 bug。
 */
function matchAll(text, pattern) {
  const re = new RegExp(pattern, 'g');
  const out = [];
  const s = String(text == null ? '' : text);
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push(m[0]);
    if (m[0] === '') re.lastIndex += 1;
  }
  return out;
}

module.exports = { escapeRegExp, matchAll };
