/**
 * server 测试
 *
 * ⚠️ 本题目标：适配 async。
 */

const assert = require('assert');
const { startServer } = require('../src/server');

/**
 * 测试：服务器启动后能拿到配置
 */
async function testServerStarts() {
  const server = startServer('/nonexistent/config.json');

  const config = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务器 3 秒内没有发出 configured 事件')), 3000);
    server.on('configured', (cfg) => {
      clearTimeout(timer);
      resolve(cfg);
    });
  });

  assert.strictEqual(config.port, 3000, `port 应为 3000，实际 ${config.port}`);
  assert.strictEqual(config.name, 'app', `name 应为 app，实际 ${config.name}`);

  server.close();
}

/**
 * 测试：服务器能响应 HTTP 请求
 */
async function testServerResponds() {
  const http = require('http');
  const server = startServer('/nonexistent/config.json');

  const port = await new Promise((resolve) => {
    server.on('listening', () => resolve(server.address().port));
  });

  const body = await new Promise((resolve, reject) => {
    http
      .get({ port, path: '/' }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });

  assert.strictEqual(body, 'ok', `响应体应为 ok，实际 ${body}`);
  server.close();
}

module.exports = {
  '服务器启动后能拿到配置': testServerStarts,
  '服务器能响应 HTTP 请求': testServerResponds,
};
