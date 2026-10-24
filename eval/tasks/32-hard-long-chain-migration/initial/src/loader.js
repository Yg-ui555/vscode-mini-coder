/**
 * 配置加载器
 *
 * ⚠️ 本题目标：改成 async。
 *
 * 这里是最容易改的一处 —— 直接 import + 直接调用。
 */

const { readConfig } = require('./config');

/**
 * 加载配置并加工
 */
function loadConfig(path) {
  const config = readConfig(path);
  return {
    ...config,
    url: `http://${config.name}:${config.port}`,
  };
}

// ⚠️ 本模块把 readConfig 也【重新导出】了一遍（proxy 层）。
//    bootstrap.js 就是从这里拿 readConfig 的 ——
//    所以改 readConfig 的签名时，这一层也要一起考虑。
module.exports = { loadConfig, readConfig };
