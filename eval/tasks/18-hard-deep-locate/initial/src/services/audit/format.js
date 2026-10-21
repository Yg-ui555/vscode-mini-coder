/**
 * 审计日志的展示格式化。
 *
 * ⚠️ 这个文件和 src/services/account/profile/format.js 同名，
 *   也导出一个叫 displayName 的函数——但这里的入参是【审计记录】，
 *   只有 actor 字段，没有 name / handle。
 *   它的 displayName 本身是正确的，别去动它。
 */

function displayName(record) {
  return (record && record.actor) || 'system';
}

function auditLine(record) {
  return record.time + ' ' + displayName(record) + ' ' + record.action;
}

module.exports = { displayName, auditLine };