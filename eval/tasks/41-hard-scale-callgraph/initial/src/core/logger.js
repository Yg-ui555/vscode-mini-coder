/**
 * 简易日志器。
 *
 * ⚠️ 这里刻意不引三方库 —— 沙箱里没有 node_modules，
 *    依赖越少，评测跑起来越稳。
 */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

let currentLevel = LEVELS.info;

/** 设置日志级别 */
function setLevel(name) {
  if (Object.prototype.hasOwnProperty.call(LEVELS, name)) currentLevel = LEVELS[name];
}

/** 格式化一条日志 */
function format(level, scope, message) {
  const stamp = new Date().toISOString();
  return '[' + stamp + '] ' + level.toUpperCase().padEnd(5) + ' ' + (scope ? scope + ': ' : '') + message;
}

/** 记一条日志 */
function log(level, scope, message) {
  if (LEVELS[level] > currentLevel) return;
  // eslint-disable-next-line no-console
  console.log(format(level, scope, message));
}

module.exports = {
  setLevel,
  log,
  error: (scope, m) => log('error', scope, m),
  warn: (scope, m) => log('warn', scope, m),
  info: (scope, m) => log('info', scope, m),
  debug: (scope, m) => log('debug', scope, m),
};
