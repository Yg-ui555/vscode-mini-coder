/**
 * 进程内缓存。
 *
 * ⚠️ 没有 TTL —— 这层缓存只活在一个请求的生命周期里。
 */
const store = new Map();

/** 读 */
function cacheGet(key) {
  return store.get(key);
}

/** 写 */
function cacheSet(key, value) {
  store.set(key, value);
  return value;
}

/** 清空 */
function cacheClear() {
  store.clear();
}

module.exports = { cacheGet, cacheSet, cacheClear };
