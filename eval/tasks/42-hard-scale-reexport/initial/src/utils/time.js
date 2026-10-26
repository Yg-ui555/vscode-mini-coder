/**
 * 时间展示。
 */
const { formatDate } = require('../core/date');

/** 相对时间 */
function relative(ts, now) {
  const diff = (now === undefined ? Date.now() : now) - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const hours = Math.round(min / 60);
  if (hours < 24) return hours + ' 小时前';
  return formatDate(ts);
}

module.exports = { relative };
