/**
 * 摘要任务。
 */
const { wordCount } = require('../../../core/src/util/text');

/** 生成摘要 */
function digest(text) {
  return { words: wordCount(text), at: Date.now() };
}

module.exports = { digest };
