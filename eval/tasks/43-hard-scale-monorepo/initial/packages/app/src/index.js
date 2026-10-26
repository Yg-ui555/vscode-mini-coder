/**
 * app 包的总入口。
 */
const shared = require('./shared/userAdapter');
const labels = require('./shared/labelKit');
const ids = require('./shared/userIdKit');
const logger = require('./shared/logger');
const config = require('./shared/config');

module.exports = {
  formatUserFor: shared.formatUserFor,
  renderLabel: labels.renderLabel,
  formatUserTag: ids.formatUserTag,
  log: logger.log,
  config: config.get,
};
