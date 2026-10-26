/**
 * 搜索框的纯逻辑部分。
 */
const { normalizeSpace } = require('../../../core/src/util/text');

/** 规整输入 */
function normalizeQuery(q) {
  return normalizeSpace(q);
}

/** 输入框的状态 */
function stateOf(q) {
  const text = normalizeQuery(q);
  return { text, empty: text.length === 0 };
}

module.exports = { normalizeQuery, stateOf };
