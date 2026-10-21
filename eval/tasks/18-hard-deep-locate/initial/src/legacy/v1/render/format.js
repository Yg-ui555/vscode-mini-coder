/**
 * v1 版报表渲染用的格式化（已经冻结，不再维护）。
 *
 * ⚠️ 这是仓库里第三个叫 format.js 的文件，也是埋得最深的一个。
 *   它导出的是 formatName / formatRole，跟 profile 那份毫无关系。
 */

function formatName(raw) {
  const t = (raw || '').trim();
  return t === '' ? '未命名' : t;
}

function formatRole(role) {
  return String(role || 'guest').toLowerCase();
}

module.exports = { formatName, formatRole };