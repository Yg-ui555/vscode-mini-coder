/**
 * 环境变量读取 —— 沙箱里没有 .env，所以全部有默认值。
 */

/** 读字符串 */
function str(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

/** 读数字 */
function num(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

/** 读布尔 */
function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

module.exports = { str, num, bool };
