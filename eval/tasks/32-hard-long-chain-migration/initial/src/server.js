/**
 * HTTP 服务器
 *
 * ⚠️ 本题目标：改成 async。
 *
 * ⭐ 这个调用点在【回调函数里】——
 *    agent 用 grep 找 "readConfig" 时能搜到，
 *    但如果只盯着 import 语句看，就【漏掉】这一处。
 */

const http = require('http');
const { readConfig } = require('./config');

/**
 * 启动服务器
 *
 * ⚠️ readConfig 在 listen 的回调里被调用。
 *    改 async 之后，这里的处理方式必须调整。
 */
function startServer(configPath) {
  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('ok');
  });

  server.listen(0, () => {
    // ⚠️ 这里在回调里调用了 readConfig
    const config = readConfig(configPath);
    console.log(`[server] started on port ${config.port}`);
    server.emit('configured', config);
  });

  return server;
}

module.exports = { startServer };
