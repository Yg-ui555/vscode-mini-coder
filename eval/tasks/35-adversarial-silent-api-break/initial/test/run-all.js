/**
 * 测试运行器
 *
 * ⭐ 本题的关键证据链：跑完所有测试全绿。
 *
 * ⚠️ 但本题的测试【只覆盖成功路径】——
 *    错误路径靠 check.js 单独验。
 *    这正是本题想暴露的问题：错误路径没人测，
 *    重构时被"顺手清理"掉，agent 自己根本发现不了。
 */

const assert = require('assert');
const path = require('path');

const TEST_FILES = ['sms.test.js', 'dispatcher.test.js'];

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
