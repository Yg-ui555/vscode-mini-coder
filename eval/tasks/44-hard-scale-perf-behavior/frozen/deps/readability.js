/**
 * 可读性。
 */
const { analyze } = require('../analyzer');

/** { flesch, grade } */
function derive(text) {
  return analyze(text).readability;
}

module.exports = { derive };
