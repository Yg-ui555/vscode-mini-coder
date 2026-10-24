/**
 * format 测试
 *
 * ⚠️ 本题目标：适配新的记录结构（期望值要一起更新）。
 */

const assert = require('assert');
const { formatRecord } = require('../src/format');
const { findRecord } = require('../src/records');

/**
 * 测试：格式化一条记录
 */
async function testFormatRecord() {
  const rec = findRecord('r-1');
  assert.strictEqual(formatRecord(rec), 'Alpha by u-7');
}

/**
 * 测试：格式化 owner 查不到的记录
 */
async function testFormatUnknownOwner() {
  const rec = findRecord('r-4');
  assert.strictEqual(formatRecord(rec), 'Delta by u-404');
}

module.exports = {
  '格式化一条记录': testFormatRecord,
  '格式化 owner 查不到的记录': testFormatUnknownOwner,
};
