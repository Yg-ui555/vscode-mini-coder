/**
 * app 侧配置。
 */
const DEFAULTS = { locale: 'zh-CN', pageSize: 20, theme: 'light' };

let current = Object.assign({}, DEFAULTS);

/** 覆盖配置 */
function configure(patch) {
  current = Object.assign({}, current, patch || {});
  return current;
}

/** 读配置 */
function get() {
  return Object.assign({}, current);
}

module.exports = { configure, get, DEFAULTS };
