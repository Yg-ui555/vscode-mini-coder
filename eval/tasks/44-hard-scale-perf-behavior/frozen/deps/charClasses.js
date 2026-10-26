/**
 * 字符构成。
 */
const { analyze } = require('../analyzer');

/** { letters, digits, spaces, punctuation, cjk } */
function derive(text) {
  const s = analyze(text);
  return {
    letters: s.letters,
    digits: s.digits,
    spaces: s.spaces,
    punctuation: s.punctuation,
    cjk: s.cjk,
  };
}

module.exports = { derive };
