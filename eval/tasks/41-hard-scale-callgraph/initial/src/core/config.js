/**
 * 运行期配置。
 *
 * 真实的项目里这些值来自环境变量 / 配置文件，
 * 这里用一组默认值兜底，保证沙箱里能直接跑。
 */
const DEFAULTS = {
  env: 'development',
  logLevel: 'info',
  timeoutMs: 30000,
  maxRetries: 3,
};

let current = { ...DEFAULTS };

/** 覆盖部分配置 */
function configure(patch) {
  current = { ...current, ...(patch || {}) };
  return current;
}

/** 读当前配置 */
function get() {
  return { ...current };
}

/** 恢复到默认值（测试用） */
function reset() {
  current = { ...DEFAULTS };
  return current;
}

module.exports = { configure, get, reset, DEFAULTS };
