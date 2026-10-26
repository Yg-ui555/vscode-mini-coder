#!/usr/bin/env node
/**
 * 库的入口 —— 只是把 public 层再包一层，方便 require。
 */
const pub = require('./src/public');

/** 对外暴露的全部符号 */
function describe() {
  return Object.keys(pub).sort();
}

if (require.main === module) {
  console.log(describe().join('\n'));
}

module.exports = pub;
module.exports.describe = describe;
