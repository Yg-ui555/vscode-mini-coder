#!/usr/bin/env node
/**
 * job-runner 的命令行入口。
 *
 * 用法：
 *   node index.js --list-kinds     列出当前注册的所有 job kind
 *   node index.js --run <kind>     用默认输入跑一个 job
 *
 * ⚠️ --list-kinds 反映的是【运行期】注册表里的内容，
 *    跟"grep 能搜到多少个 kind"不一定对得上 ——
 *    有些实现是在被加载的时候才登记自己的。
 */
const loader = require('./src/core/loader');
const registry = require('./src/core/registry');

/** 加载全部实现并返回注册表 */
function boot() {
  loader.loadAll();
  return registry;
}

function main(argv) {
  const arg = argv[2];

  if (arg === '--list-kinds') {
    boot();
    console.log(registry.kinds().join('\n'));
    return 0;
  }

  if (arg === '--run') {
    boot();
    const kind = argv[3];
    if (!kind) {
      console.error('用法：node index.js --run <kind>');
      return 1;
    }
    const result = registry.dispatch(kind, { amount: 12345, label: 'demo', count: 3 });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.log('用法：node index.js --list-kinds | --run <kind>');
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { boot, main };
