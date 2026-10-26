/**
 * 对外导出清单的自我描述。
 */

/** 当前公开 API 的版本号 */
function publicVersion() {
  return '2.4.0';
}

/** 列出所有对外符号 */
function describeExports() {
  const mod = require('./index');
  return Object.keys(mod).sort();
}

module.exports = { publicVersion, describeExports };
