/**
 * core 包的总入口。
 */
const user = require('./user');
const order = require('./order');
const billing = require('./billing');
const util = require('./util');

module.exports = Object.assign({}, user, order, billing, util, {
  coreVersion: '1.3.0',
});
