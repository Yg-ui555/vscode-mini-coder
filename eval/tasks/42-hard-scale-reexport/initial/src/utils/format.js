/**
 * 展示层格式化。
 */
const { formatBytes } = require('../core/number');

/** 文件大小 */
function fileSize(bytes) {
  return formatBytes(bytes, 2);
}

/** 百分比 */
function percent(n) {
  return (Math.round((Number(n) || 0) * 1000) / 10).toFixed(1) + '%';
}

module.exports = { fileSize, percent };
