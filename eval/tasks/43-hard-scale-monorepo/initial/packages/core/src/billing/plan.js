/**
 * 订阅计划。
 */
const PLANS = {
  basic: { price: 9900, seats: 1 },
  pro: { price: 29900, seats: 5 },
};

/** 查计划 */
function getPlan(name) {
  return PLANS[name] || null;
}

module.exports = { getPlan, PLANS };
