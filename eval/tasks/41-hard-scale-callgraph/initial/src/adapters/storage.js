/**
 * 存储适配层 —— 一个内存 KV，用来放 job 的中间产物。
 */
const store = new Map();

/** 写 */
function put(key, value) {
  store.set(key, value);
  return value;
}

/** 读 */
function get(key) {
  return store.get(key);
}

/** 删 */
function del(key) {
  return store.delete(key);
}

/** 按前缀扫描 */
function scan(prefix) {
  const out = [];
  for (const [k, v] of store) {
    if (k.startsWith(prefix)) out.push([k, v]);
  }
  return out;
}

module.exports = { put, get, del, scan };
