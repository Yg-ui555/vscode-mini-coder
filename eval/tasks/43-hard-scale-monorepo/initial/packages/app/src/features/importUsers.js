/**
 * 批量导入用户。
 */
const { normalizeUser } = require('../../../core/src/user/normalize');

/** 解析导入的行 */
function parseRows(rows) {
  return (rows || []).map((r) => normalizeUser({ name: r[0], age: Number(r[1]) || 0 }));
}

module.exports = { parseRows };
