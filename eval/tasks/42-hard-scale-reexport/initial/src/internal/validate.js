/**
 * 载荷校验。
 */

/**
 * 校验一个对象必填字段。
 *
 * @returns {string[]} 缺失的字段名，空数组表示通过
 */
function validatePayload(payload, required) {
  const missing = [];
  for (const field of required || []) {
    if (!payload || payload[field] === undefined || payload[field] === null) missing.push(field);
  }
  return missing;
}

module.exports = { validatePayload };
