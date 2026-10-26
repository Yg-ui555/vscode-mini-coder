/**
 * 折扣计算。
 */
const RULES = [
  { code: 'NEW10', off: 0.1 },
  { code: 'VIP20', off: 0.2 },
];

/** 找折扣规则 */
function findRule(code) {
  return RULES.filter((r) => r.code === code)[0] || null;
}

/** 折后金额（分） */
function applyDiscount(amount, code) {
  const rule = findRule(code);
  if (!rule) return Math.round(Number(amount) || 0);
  return Math.round((Number(amount) || 0) * (1 - rule.off));
}

module.exports = { findRule, applyDiscount };
