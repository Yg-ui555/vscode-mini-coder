/**
 * loader 测试
 *
 * ⚠️ 本题目标：适配 async。
 */

const assert = require('assert');
const { loadConfig } = require('../src/loader');

/**
 * 测试：loadConfig 返回带 url 的配置
 */
async function testLoadConfig() {
  const cfg = await loadConfig('/nonexistent/config.json');
  assert.strictEqual(cfg.name, 'app', `name 应为 app，实际 ${cfg.name}`);
  assert.strictEqual(cfg.port, 3000, `port 应为 3000，实际 ${cfg.port}`);
  assert.strictEqual(cfg.url, 'http://app:3000', `url 不对：${cfg.url}`);
}

/**
 * 测试：自定义配置被正确读取
 */
async function testCustomConfig() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const tmp = path.join(os.tmpdir(), `cfg-${Date.now()}.json`);
  fs.writeFileSync(
    tmp,
    JSON.stringify({ name: 'svc', port: '8080', debug: true, features: { beta: true } }),
  );
  try {
    const cfg = await loadConfig(tmp);
    assert.strictEqual(cfg.name, 'svc', `name 应为 svc，实际 ${cfg.name}`);
    assert.strictEqual(cfg.port, 8080, `端口应转成数字 8080，实际 ${cfg.port}`);
    assert.strictEqual(cfg.debug, true, 'debug 应为 true');
    assert.strictEqual(cfg.features.beta, true, 'beta 应为 true');
    assert.strictEqual(cfg.features.cache, true, 'cache 默认值应保留');
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (e) {
      /* 清理失败不致命 */
    }
  }
}

module.exports = {
  'loadConfig 返回默认配置': testLoadConfig,
  'loadConfig 读取自定义配置': testCustomConfig,
};
