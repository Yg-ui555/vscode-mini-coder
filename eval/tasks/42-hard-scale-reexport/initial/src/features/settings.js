/**
 * 设置页。
 */
const { deepMerge } = require('../core/object');

/** 合并默认设置和用户设置 */
function resolveSettings(defaults, user) {
  return deepMerge(defaults, user);
}

module.exports = { resolveSettings };
