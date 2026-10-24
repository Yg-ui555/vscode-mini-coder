/**
 * worker 测试
 *
 * ⚠️ 本题目标：适配 async。
 */

const assert = require('assert');
const { processTask } = require('../src/worker');

/**
 * 测试：任务处理完能拿到配置
 */
async function testProcessTask() {
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('任务 3 秒内没完成')), 3000);
    processTask('/nonexistent/config.json', (r) => {
      clearTimeout(timer);
      resolve(r);
    });
  });

  assert.strictEqual(result.port, 3000, `port 应为 3000，实际 ${result.port}`);
  assert.strictEqual(result.name, 'app', `name 应为 app，实际 ${result.name}`);
}

module.exports = {
  '任务处理完能拿到配置': testProcessTask,
};
