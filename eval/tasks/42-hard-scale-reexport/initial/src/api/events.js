/**
 * 事件接口。
 */
const { trackEvent, readEvents } = require('../public/analytics');

/** 上报 */
function emit(name, props) {
  return trackEvent(name, props);
}

/** 查询 */
function list() {
  return readEvents();
}

module.exports = { emit, list };
