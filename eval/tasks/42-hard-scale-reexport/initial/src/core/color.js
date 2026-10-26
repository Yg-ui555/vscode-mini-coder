/**
 * 颜色工具。
 */

/** #rrggbb → { r, g, b } */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** { r, g, b } → #rrggbb */
function rgbToHex(rgb) {
  if (!rgb) return '#000000';
  const part = (v) => Math.max(0, Math.min(255, Number(v) || 0)).toString(16).padStart(2, '0');
  return '#' + part(rgb.r) + part(rgb.g) + part(rgb.b);
}

module.exports = { hexToRgb, rgbToHex };
