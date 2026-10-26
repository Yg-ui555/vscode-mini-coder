/**
 * 管理端接口。
 */
const pub = require('../public');

/** 管理端概览 */
function adminOverview() {
  return { version: pub.publicVersion(), exports: pub.describeExports().length };
}

module.exports = { adminOverview };
