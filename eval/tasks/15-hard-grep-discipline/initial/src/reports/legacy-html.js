/**
 * 老报表模板渲染（legacy HTML）。
 *
 * ⚠️ 这个文件名里有 legacy，但跟金额格式化【没有任何关系】——
 * 它是给 v1 版报表用的 HTML 模板渲染，和 format.js 是两回事。
 * 迁移 legacyFormat 时不要动这里。
 */

const ROWS = [
  { name: 'widget', amount: 1250 },
  { name: 'gizmo', amount: 999 },
];

/** 这里的金额拼装是当年手写的，跟 format.js 没有任何共用代码 */
function amountCell(cents) {
  const dollars = Math.floor(Math.abs(cents) / 100);
  const rest = String(Math.abs(cents) % 100);
  const padded = rest.length < 2 ? '0' + rest : rest;
  const sign = cents < 0 ? '-' : '';
  return sign + dollars + '.' + padded;
}

function rowHtml(row) {
  return '<tr><td>' + row.name + '</td><td>' + amountCell(row.amount) + '</td></tr>';
}

function tableHtml() {
  return '<table>' + ROWS.map(rowHtml).join('') + '</table>';
}

module.exports = { ROWS, amountCell, rowHtml, tableHtml };