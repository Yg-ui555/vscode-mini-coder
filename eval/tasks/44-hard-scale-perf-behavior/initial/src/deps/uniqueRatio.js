/**
 * 不重复词占比。
 */
const { analyze } = require('../analyzer');

/** 占比 */
function derive(text) {
  const s = analyze(text);
  if (!s.tokenCount) return 0;
  return Math.round((s.uniqueTokens / s.tokenCount) * 10000) / 10000;
}

module.exports = { derive };
