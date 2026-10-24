/**
 * 测试运行器
 *
 * ⭐ 本题的关键证据链：跑完所有测试全绿。
 *
 * 为什么自己写一个而不依赖 jest/mocha：
 *   沙箱里没有 node_modules，装不了测试框架。
 *   自己写一个 40 行的 runner，零依赖，还更可控。
 */

const assert = require('assert');
const path = require('path');

const TEST_FILES = ['loader.test.js', 'server.test.js', 'worker.test.js', 'bootstrap.test.js'];

/**
 * 跑所有测试
 *
 * @returns {Promise<{passed: number, failed: number, failures: Array}>}
 */
async function runAll() {
  const failures = [];
  let passed = 0;

  for (const file of TEST_FILES) {
    const mod = require(path.join(__dirname, file));
    for (const [name, fn] of Object.entries(mod)) {
      try {
        await fn();
        passed++;
      } catch (e) {
        failures.push({ file, name, error: e && e.message ? e.message : String(e) });
      }
    }
  }

  return { passed, failed: failures.length, failures };
}

// 直接运行时打印结果
if (require.main === module) {
  runAll().then((r) => {
    console.log(`\n通过 ${r.passed} 个，失败 ${r.failed} 个`);
    for (const f of r.failures) {
      console.log(`  ✗ [${f.file}] ${f.name}\n    ${f.error}`);
    }
    process.exit(r.failed > 0 ? 1 : 0);
  });
}

module.exports = { runAll, TEST_FILES };
