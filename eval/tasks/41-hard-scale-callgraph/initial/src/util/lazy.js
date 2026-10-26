/**
 * 惰性求值 —— 第一次访问才真正算。
 */

/** 造一个惰性值 */
function lazy(factory) {
  let called = false;
  let value;
  return {
    get() {
      if (!called) {
        called = true;
        value = factory();
      }
      return value;
    },
    get called() {
      return called;
    },
  };
}

/** 记忆化：同一个 key 只算一次 */
function memoize(fn) {
  const cache = new Map();
  return function memoized(key) {
    if (cache.has(key)) return cache.get(key);
    const value = fn(key);
    cache.set(key, value);
    return value;
  };
}

module.exports = { lazy, memoize };
