/**
 * 后台 worker
 *
 * ⚠️ 本题目标：改成 async。
 *
 * ⭐ 这个调用点用的是【动态 require + 字符串路径】——
 *    grep "require('./config')" 搜不到它，
 *    必须 grep "readConfig" 或 "config" 才能找到。
 *    这是最容易漏的一处。
 */

const path = require('path');

/**
 * 处理一个任务
 *
 * ⚠️ readConfig 在【普通回调】里被调用。
 */
function processTask(taskPath, onDone) {
  const modulePath = path.join(__dirname, 'config');
  // ⚠️ 动态 require：静态 import 分析找不到这里
  const { readConfig } = require(modulePath);

  setTimeout(() => {
    const config = readConfig(taskPath);
    onDone({ task: taskPath, port: config.port, name: config.name });
  }, 0);
}

module.exports = { processTask };
