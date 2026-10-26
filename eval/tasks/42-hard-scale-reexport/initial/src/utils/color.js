/**
 * 颜色工具（跟 core 的重名，但用途不同）。
 */
const { hexToRgb } = require('../core/color');

/** 判断是不是浅色背景（决定用黑字还是白字） */
function isLight(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 > 150;
}

module.exports = { isLight };
