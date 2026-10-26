/**
 * 关键词密度（去停用词后的词频）。
 */
const { analyze } = require('../analyzer');

/** { unique, density } */
function derive(text) {
  const s = analyze(text);
  const density = s.tokenCount ? Math.round((s.uniqueTokens / s.tokenCount) * 10000) / 10000 : 0;
  return { unique: s.uniqueTokens, density: density };
}

module.exports = { derive };
