/**
 * 导入。
 */
const { safeParse } = require('../core/json');

/** 解析导入文件内容 */
function parseImport(text) {
  const parsed = safeParse(text, null);
  if (!parsed || !Array.isArray(parsed.rows)) return { ok: false, count: 0 };
  return { ok: true, count: parsed.rows.length };
}

module.exports = { parseImport };
