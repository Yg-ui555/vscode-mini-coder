/**
 * CLI 入口
 *
 * ⚠️ 本题目标：改成 async。
 *
 * ⭐ 这里在【模块顶层】直接调用 ——
 *    CommonJS 没有顶层 await，
 *    所以必须包一层（main().then() 或者 async main()）。
 */

const { readConfig } = require('./config');

/**
 * 打印配置
 */
function printConfig(configPath) {
  const config = readConfig(configPath);
  const lines = [
    `name: ${config.name}`,
    `port: ${config.port}`,
    `debug: ${config.debug}`,
    `beta: ${config.features.beta}`,
  ];
  return lines.join('\n');
}

/**
 * 主流程
 */
function main(argv) {
  const configPath = argv[2] || './config.json';
  const output = printConfig(configPath);
  console.log(output);
  return output;
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, printConfig };
