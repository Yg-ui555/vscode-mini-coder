/**
 * 标准答案 —— 32-hard-long-chain-migration
 *
 * 目的：证明这道题【有解】。
 *   如果连人写的标准答案都过不了所有 case，
 *   那这道题就不是难题，是废题 ——
 *   它会以「满分率下降」的形式把评测者引到错误方向。
 *
 * 标准解法（6 步）：
 *   1. src/config.js    —— readConfig 改成 async
 *   2. src/loader.js    —— loadConfig 改成 async + await；readConfig 的重新导出保持不变
 *   3. src/server.js    —— listen 回调里改成 .then()
 *   4. src/worker.js    —— setTimeout 回调里改成 .then()
 *   5. src/cli.js       —— printConfig / main 改成 async，顶层调用包 .catch()
 *   6. src/bootstrap.js —— 从 loader 重新导出拿的 readConfig，也要改成 .then()
 *
 * ⚠️ 注意第 6 步：这是最容易漏的一处。
 *    bootstrap.js 并没有 require('./config')，
 *    它 require 的是 './loader' —— 靠 loader 的重新导出拿到 readConfig。
 *    只盯着"谁 require 了源文件"就会漏掉它。
 *
 * ⚠️ 注意测试文件【一个字都不用改】：
 *    测试本来就已经写了 await（写测试的时候用 await 是好习惯，
 *    它对同步值和 Promise 都成立），所以适配完之后它们直接就绿了。
 *    改测试反而是作弊 —— 本题的 check.js 会检查断言期望值有没有被改。
 */

const fs = require('fs');
const path = require('path');

/** 替换并校验锚点存在（锚点没了说明 initial/ 变了，标准答案该同步更新） */
function replaceOnce(src, from, to, where) {
  if (!src.includes(from)) {
    throw new Error(`标准答案锚点没找到（${where}）：\n${from}`);
  }
  return src.replace(from, to);
}

/** 读改写 */
function patch(dir, rel, fn) {
  const p = path.join(dir, rel);
  const src = fs.readFileSync(p, 'utf-8');
  fs.writeFileSync(p, fn(src), 'utf-8');
}

module.exports = {
  taskId: '32-hard-long-chain-migration',

  apply(dir) {
    // ── 1. config.js：readConfig 改成 async ──
    patch(dir, 'src/config.js', (src) =>
      replaceOnce(
        src,
        'function readConfig(path) {',
        'async function readConfig(path) {',
        'src/config.js',
      ),
    );

    // ── 2. loader.js：loadConfig 改成 async + await ──
    //    ⚠️ 重新导出的 readConfig 不用动（它指向的就是 config.js 里那个 async 函数）
    patch(dir, 'src/loader.js', (src) =>
      replaceOnce(
        src,
        ['function loadConfig(path) {', '  const config = readConfig(path);'].join('\n'),
        ['async function loadConfig(path) {', '  const config = await readConfig(path);'].join(
          '\n',
        ),
        'src/loader.js',
      ),
    );

    // ── 3. server.js：listen 回调里用 .then() ──
    //    ⚠️ startServer 保持同步返回 server 对象 —— 改了这个 API 就破坏现有调用方
    patch(dir, 'src/server.js', (src) =>
      replaceOnce(
        src,
        [
          '    const config = readConfig(configPath);',
          '    console.log(`[server] started on port ${config.port}`);',
          "    server.emit('configured', config);",
        ].join('\n'),
        [
          '    readConfig(configPath).then((config) => {',
          '      console.log(`[server] started on port ${config.port}`);',
          "      server.emit('configured', config);",
          '    });',
        ].join('\n'),
        'src/server.js',
      ),
    );

    // ── 4. worker.js：setTimeout 回调里用 .then() ──
    patch(dir, 'src/worker.js', (src) =>
      replaceOnce(
        src,
        [
          '    const config = readConfig(taskPath);',
          '    onDone({ task: taskPath, port: config.port, name: config.name });',
        ].join('\n'),
        [
          '    readConfig(taskPath).then((config) => {',
          '      onDone({ task: taskPath, port: config.port, name: config.name });',
          '    });',
        ].join('\n'),
        'src/worker.js',
      ),
    );

    // ── 5. cli.js：printConfig / main 改成 async，顶层包 .catch() ──
    patch(dir, 'src/cli.js', (src) => {
      let out = src;

      out = replaceOnce(
        out,
        ['function printConfig(configPath) {', '  const config = readConfig(configPath);'].join(
          '\n',
        ),
        [
          'async function printConfig(configPath) {',
          '  const config = await readConfig(configPath);',
        ].join('\n'),
        'src/cli.js / printConfig',
      );

      out = replaceOnce(
        out,
        [
          'function main(argv) {',
          "  const configPath = argv[2] || './config.json';",
          '  const output = printConfig(configPath);',
        ].join('\n'),
        [
          'async function main(argv) {',
          "  const configPath = argv[2] || './config.json';",
          '  const output = await printConfig(configPath);',
        ].join('\n'),
        'src/cli.js / main',
      );

      out = replaceOnce(
        out,
        ['if (require.main === module) {', '  main(process.argv.slice(2));', '}'].join('\n'),
        [
          'if (require.main === module) {',
          '  main(process.argv.slice(2)).catch((err) => {',
          '    console.error(err);',
          '    process.exit(1);',
          '  });',
          '}',
        ].join('\n'),
        'src/cli.js / 顶层调用',
      );

      return out;
    });

    // ── 6. bootstrap.js：从 loader 重新导出的 readConfig，也要改 ──
    //    ⚠️ 最容易漏的一处：它 require 的是 './loader'，不是 './config'
    patch(dir, 'src/bootstrap.js', (src) =>
      replaceOnce(
        src,
        [
          '  const config = readConfig(configPath);',
          '  onReady({ app: config.name, port: config.port });',
        ].join('\n'),
        [
          '  readConfig(configPath).then((config) => {',
          '    onReady({ app: config.name, port: config.port });',
          '  });',
        ].join('\n'),
        'src/bootstrap.js',
      ),
    );

    // ── 测试文件一个字都不用改 ──
    //    （测试本来就用了 await，对同步值和 Promise 都成立）
  },
};
