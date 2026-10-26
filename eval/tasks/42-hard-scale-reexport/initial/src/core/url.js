/**
 * URL 工具。
 */

/** 解析查询串 */
function parseQuery(query) {
  const out = {};
  const q = String(query || '').replace(/^\?/, '');
  for (const pair of q.split('&')) {
    if (!pair) continue;
    const i = pair.indexOf('=');
    const k = decodeURIComponent(i === -1 ? pair : pair.slice(0, i));
    const v = i === -1 ? '' : decodeURIComponent(pair.slice(i + 1));
    out[k] = v;
  }
  return out;
}

/** 拼查询串 */
function buildQuery(obj) {
  const parts = [];
  for (const k of Object.keys(obj || {})) {
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
  }
  return parts.join('&');
}

module.exports = { parseQuery, buildQuery };
