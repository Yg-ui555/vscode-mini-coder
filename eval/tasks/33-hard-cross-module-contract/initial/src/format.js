/**
 * 记录格式化
 *
 * ⚠️ 本题目标：适配新的记录结构。
 *
 * ⚠️ 注意：这里读的是【记录对象】的字段，
 *    所以记录结构一变，这里就必须跟着改。
 */

function formatRecord(rec) {
  return `${rec.name} by ${rec.ownerId}`;
}

module.exports = { formatRecord };
