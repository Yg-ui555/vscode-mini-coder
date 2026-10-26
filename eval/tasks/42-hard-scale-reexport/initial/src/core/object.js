/**
 * 对象工具。
 */

/** 只取指定的几个 key */
function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}

/** 去掉指定的几个 key */
function omit(obj, keys) {
  const out = {};
  for (const k of Object.keys(obj || {})) {
    if (!keys.includes(k)) out[k] = obj[k];
  }
  return out;
}

/** 深合并（后者覆盖前者） */
function deepMerge(a, b) {
  const out = Object.assign({}, a || {});
  for (const k of Object.keys(b || {})) {
    const av = out[k];
    const bv = b[k];
    if (av && bv && typeof av === 'object' && typeof bv === 'object' && !Array.isArray(av) && !Array.isArray(bv)) {
      out[k] = deepMerge(av, bv);
    } else {
      out[k] = bv;
    }
  }
  return out;
}

/** 按路径取值 */
function get(obj, path, fallback) {
  const parts = String(path || '').split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return fallback;
    cur = cur[p];
  }
  return cur === undefined ? fallback : cur;
}

/** 对象上有没有这个路径 */
function has(obj, path) {
  const sentinel = {};
  return get(obj, path, sentinel) !== sentinel;
}

module.exports = { pick, omit, deepMerge, get, has };
