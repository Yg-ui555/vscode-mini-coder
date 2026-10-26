/**
 * 工具能力的汇总。
 */
const text = require('./text');
const date = require('./date');
const money = require('./money');
const id = require('./id');
const hash = require('./hash');
const assert = require('./assert');

module.exports = {
  wordCount: text.wordCount,
  normalizeSpace: text.normalizeSpace,
  clip: text.clip,
  formatDate: date.formatDate,
  addDays: date.addDays,
  formatMoney: money.formatMoney,
  sum: money.sum,
  nextId: id.nextId,
  simpleHash: hash.simpleHash,
  ok: assert.ok,
  equal: assert.equal,
};
