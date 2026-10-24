/**
 * 配置读取
 *
 * ⚠️ 本题目标：把这个函数改成 async。
 *
 * ⭐ 解析逻辑一个字都不能改 ——
 *    改完之后 readConfig 返回的 config 必须【完全一样】。
 */

const DEFAULTS = {
  name: 'app',
  port: 3000,
  debug: false,
  features: { beta: false, cache: true },
};

/**
 * 读取配置
 *
 * 当前是同步的：直接返回对象。
 * 题目要求改成 async：返回 Promise。
 *
 * ⚠️ 解析逻辑不许动：
 *   · 缺字段用默认值
 *   · 端口从字符串转成数字
 *   · 嵌套的 features 要合并
 */
function readConfig(path) {
  let raw = {};

  try {
    // 模拟从文件读配置
    const fs = require('fs');
    if (fs.existsSync(path)) {
      raw = JSON.parse(fs.readFileSync(path, 'utf-8'));
    }
  } catch (e) {
    raw = {};
  }

  return {
    name: raw.name !== undefined ? raw.name : DEFAULTS.name,
    port: raw.port !== undefined ? Number(raw.port) : DEFAULTS.port,
    debug: raw.debug !== undefined ? raw.debug : DEFAULTS.debug,
    features: Object.assign({}, DEFAULTS.features, raw.features || {}),
  };
}

module.exports = { readConfig, DEFAULTS };
