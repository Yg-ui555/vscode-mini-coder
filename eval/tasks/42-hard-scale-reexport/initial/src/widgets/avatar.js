/**
 * 头像。
 */
const { hexToRgb, rgbToHex } = require('../core/color');

/** 由 id 派生一个稳定的颜色 */
function colorFor(id) {
  let h = 0;
  for (let i = 0; i < String(id || '').length; i++) h = (h * 31 + String(id).charCodeAt(i)) >>> 0;
  return rgbToHex({ r: h & 255, g: (h >> 8) & 255, b: (h >> 16) & 255 });
}

/** 解析颜色 */
function parseColor(hex) {
  return hexToRgb(hex);
}

module.exports = { colorFor, parseColor };
