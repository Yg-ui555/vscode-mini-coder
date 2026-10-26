/**
 * 卡片。
 */
const { clamp } = require('../core/number');

/** 卡片宽度 */
function cardWidth(weight) {
  return clamp(Math.round((Number(weight) || 1) * 100), 80, 400);
}

module.exports = { cardWidth };
