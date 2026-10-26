/**
 * 音节统计。
 *
 * ⚠️ 音节数依赖 analyzer 的分词结果 —— 换个分词规则，音节总数就变了。
 */
const { analyze } = require('../analyzer');

/** 总音节数 */
function derive(text) {
  const s = analyze(text);
  return s.syllables;
}

module.exports = { derive };
