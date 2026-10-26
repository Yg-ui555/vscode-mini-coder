/**
 * 哈希工具。
 *
 * ⚠️ 这里用的是简单哈希，不是密码学哈希 ——
 *   用途是"快速判断两段内容是不是一样"，不是防篡改。
 */

/** 简单字符串哈希（djb2 变体） */
function simpleHash(s) {
  const str = String(s == null ? '' : s);
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 稳定序列化 —— 对象的 key 排序后再输出。
 *
 * ⚠️ 排序是必须的：不然同样内容的两个对象序列化结果可能不一样，
 *   拿它做哈希/比对会得出错误结论。
 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

module.exports = { simpleHash, stableStringify };
