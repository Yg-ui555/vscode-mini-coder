/**
 * 解析 key=value 格式的简单配置文本
 *
 * 典型用法：
 *   const { parseConfig } = require('./config');
 *   parseConfig('host = localhost\nport = 8080');
 *   // => { host: 'localhost', port: '8080' }
 */

/**
 * 解析配置文本
 * @param {string} text
 * @returns {Object<string, string>}
 */
function parseConfig(text) {
  const result = {};
  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    const value = t.slice(i + 1).trim();
    result[key] = value;
  }
  return result;
}

/**
 * 读一个配置项，读不到就用默认值
 * @param {string} text
 * @param {string} key
 * @param {*} defaultValue
 * @returns {*}
 */
function getConfigValue(text, key, defaultValue) {
  const cfg = parseConfig(text);
  return key in cfg ? cfg[key] : defaultValue;
}

module.exports = { parseConfig, getConfigValue };