/**
 * 两份配置的差异。
 */
const { stableStringify } = require('../core/hash');

/** 比较两个对象（只看第一层 key） */
function diff(a, b) {
  const out = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const av = a ? a[k] : undefined;
    const bv = b ? b[k] : undefined;
    if (stableStringify(av) !== stableStringify(bv)) out.push({ key: k, from: av, to: bv });
  }
  return out;
}

module.exports = { diff };
