/**
 * 极简 query string 解析 / 序列化
 *
 * 目前 parseQuery 只做了最朴素的事情：按 & 切、按第一个 = 分，
 * 没有任何解码，也没有处理重复 key 和裸 flag。
 */

const PAIR_SEP = '&';
const KEY_VALUE_SEP = '=';

/**
 * 解析 a=1&b=2 这种字符串
 * @param {string} str
 * @returns {Object}
 */
function parseQuery(str) {
  const result = {};
  if (!str) return result;
  for (const part of String(str).split(PAIR_SEP)) {
    const i = part.indexOf(KEY_VALUE_SEP);
    if (i < 0) continue;
    result[part.slice(0, i)] = part.slice(i + 1);
  }
  return result;
}

/**
 * 把对象序列化回 a=1&b=2 这种字符串（值会做 URL 编码）
 * 数组值会展开成重复的 key。
 */
function stringifyQuery(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const parts = [];
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        parts.push(`${encodeURIComponent(key)}${KEY_VALUE_SEP}${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}${KEY_VALUE_SEP}${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join(PAIR_SEP);
}

/**
 * 数一数里面有多少个合法的 key=value 片段（裸 flag 和空片段都不算）
 */
function countPairs(str) {
  if (!str || typeof str !== 'string') return 0;
  let n = 0;
  for (const part of str.split(PAIR_SEP)) {
    if (part === '') continue;
    if (part.indexOf(KEY_VALUE_SEP) < 0) continue;
    n += 1;
  }
  return n;
}

/**
 * 按 & 切成非空片段（不做任何解码）
 */
function splitPairs(str) {
  if (!str || typeof str !== 'string') return [];
  return String(str)
    .split(PAIR_SEP)
    .filter((p) => p !== '');
}

/**
 * parseQuery 的安全包装，抛异常就返回空对象
 */
function parseQuerySafely(str) {
  try {
    const r = parseQuery(str);
    return r && typeof r === 'object' ? r : {};
  } catch (e) {
    return {};
  }
}

module.exports = { parseQuery, stringifyQuery, countPairs, splitPairs, parseQuerySafely };