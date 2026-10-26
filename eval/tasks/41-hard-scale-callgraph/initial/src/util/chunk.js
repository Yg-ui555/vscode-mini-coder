/**
 * 数组分块工具。
 */

/** 按 size 分块 */
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

/** 去重（保留首次出现的顺序） */
function unique(list) {
  return Array.from(new Set(list));
}

module.exports = { chunk, groupBy, unique };
