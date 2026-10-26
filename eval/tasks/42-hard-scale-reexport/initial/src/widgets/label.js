/**
 * 标签。
 */

/** 标签文案（截断规则跟别的模块不一样，是按词截的） */
function truncateLabel(text, maxWords) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ') + '…';
}

module.exports = { truncateLabel };
