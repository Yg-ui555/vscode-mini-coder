/**
 * 停用词占比。
 */
const { analyze } = require('../analyzer');

/** { count, ratio } */
function derive(text) {
  const s = analyze(text);
  return { count: s.stopwords, ratio: s.stopwordRatio };
}

module.exports = { derive };
