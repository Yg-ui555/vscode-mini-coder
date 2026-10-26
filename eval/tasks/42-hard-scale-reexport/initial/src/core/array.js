/**
 * 数组工具。
 */

/** 分块 */
function chunk(list, size) {
  const out = [];
  const s = size > 0 ? size : 1;
  for (let i = 0; i < list.length; i += s) out.push(list.slice(i, i + s));
  return out;
}

/** 按 key 分组 */
function groupBy(list, keyOf) {
  const out = new Map();
  for (const item of list) {
    const key = keyOf(item);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}

/** 去重，保留首次出现的顺序 */
function unique(list) {
  return Array.from(new Set(list));
}

/** 摊平一层 */
function flatten(list) {
  const out = [];
  for (const item of list) {
    if (Array.isArray(item)) out.push(...item);
    else out.push(item);
  }
  return out;
}

/** 第一个元素 */
function first(list) {
  return list && list.length ? list[0] : undefined;
}

/** 最后一个元素 */
function last(list) {
  return list && list.length ? list[list.length - 1] : undefined;
}

module.exports = { chunk, groupBy, unique, flatten, first, last };
