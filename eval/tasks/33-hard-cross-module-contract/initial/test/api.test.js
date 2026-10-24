/**
 * api 测试
 *
 * ⚠️ 本题目标：适配新的记录结构。
 *
 * ⚠️⚠️ 注意：这个测试的【期望值一个字都不该变】——
 *    对外 API 的形状不许跟着内部结构一起变。
 *    这正是它被放在这里的原因：它会拦住"顺手把内部改名透传出去了"的改法。
 */

const assert = require('assert');
const { toApiPayload } = require('../src/api');
const { findRecord } = require('../src/records');

/**
 * 测试：转成 API payload
 */
async function testToApiPayload() {
  const p = toApiPayload(findRecord('r-1'));
  assert.deepStrictEqual(p, { id: 'r-1', title: 'Alpha', ownerId: 'u-7' });
}

/**
 * 测试：owner 查不到的记录，payload 里的 ownerId 仍然是原来的 id
 */
async function testToApiPayloadUnknownOwner() {
  const p = toApiPayload(findRecord('r-4'));
  assert.deepStrictEqual(p, { id: 'r-4', title: 'Delta', ownerId: 'u-404' });
}

module.exports = {
  '转成 API payload': testToApiPayload,
  'owner 查不到时 payload 的 ownerId 不变': testToApiPayloadUnknownOwner,
};
