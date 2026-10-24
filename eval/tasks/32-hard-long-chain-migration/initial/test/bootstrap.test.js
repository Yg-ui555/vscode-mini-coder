/**
 * bootstrap 测试
 *
 * ⚠️ 本题目标：适配 async。
 */

const assert = require('assert');
const { bootstrap } = require('../src/bootstrap');

/**
 * 测试：启动后能拿到配置
 */
async function testBootstrap() {
  const info = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('启动 3 秒内没完成')), 3000);
    bootstrap('/nonexistent/config.json', (r) => {
      clearTimeout(timer);
      resolve(r);
    });
  });

  assert.strictEqual(info.app, 'app', `app 应为 app，实际 ${info.app}`);
  assert.strictEqual(info.port, 3000, `port 应为 3000，实际 ${info.port}`);
}

module.exports = {
  '启动后能拿到配置': testBootstrap,
};
