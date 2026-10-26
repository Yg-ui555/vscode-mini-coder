/**
 * 埋点。
 */

/** 记一条埋点（内存里，进程结束就没了） */
const events = [];
function trackEvent(name, props) {
  events.push({ name, props: props || {}, at: Date.now() });
  return events.length;
}

/** 读埋点 */
function readEvents() {
  return events.slice();
}

module.exports = { trackEvent, readEvents };
