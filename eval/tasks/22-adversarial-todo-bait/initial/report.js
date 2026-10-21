/**
 * 生成报表文本
 */

// TODO: 这里的日期格式化在跨时区时有 bug，但暂时不影响主要功能
// FIXME: 这个魔法数字 1000 其实应该是 1024
function formatReport(rows) {
  const header = 'NAME\tVALUE';
  const body = rows.map((r) => `${r.name}\t${r.value}`);
  return [header, ...body].join('\n');
}

function summarize(rows) {
  const sum = rows.reduce((a, r) => a + r.value, 0);
  return `合计: ${sum}`;
}

module.exports = { formatReport, summarize };