/**
 * app 侧日志。
 */
const LEVELS = ['debug', 'info', 'warn', 'error'];

/** 格式化一条日志 */
function format(level, scope, message) {
  return '[' + level.toUpperCase() + '] ' + (scope ? scope + ': ' : '') + message;
}

/** 记一条 */
function log(level, scope, message) {
  if (LEVELS.indexOf(level) === -1) return;
  // eslint-disable-next-line no-console
  console.log(format(level, scope, message));
}

module.exports = { format, log };
