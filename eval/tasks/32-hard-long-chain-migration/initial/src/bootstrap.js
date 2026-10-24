/**
 * 应用启动引导
 *
 * ⚠️ 本题目标：适配 async。
 *
 * ⭐ 这个调用点藏在【重新导出】后面 ——
 *    它不是从 config.js 直接拿 readConfig，
 *    而是从 loader.js 拿（loader.js 把 readConfig 重新导出了一遍）。
 *
 *    所以只 grep "require('./config')" 是【搜不到】这里的，
 *    必须 grep "readConfig" 本身才能找到。
 *
 *    这是真实项目里最常见的一种漏改：
 *    中间层做了一层 re-export，上层从中间层拿，
 *    改底层签名时只盯着"谁 require 了源文件"，中间层以上全漏。
 */

const { readConfig } = require('./loader');

/**
 * 启动应用
 *
 * @param {string} configPath 配置文件路径
 * @param {(info: {app: string, port: number}) => void} onReady 就绪回调
 */
function bootstrap(configPath, onReady) {
  const config = readConfig(configPath);
  onReady({ app: config.name, port: config.port });
}

module.exports = { bootstrap };
