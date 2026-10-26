/**
 * 税率。
 */
const RATES = { default: 0.06, reduced: 0.03 };

/** 算税 */
function taxOf(amount, kind) {
  const rate = RATES[kind] === undefined ? RATES.default : RATES[kind];
  return Math.round((Number(amount) || 0) * rate);
}

module.exports = { taxOf, RATES };
