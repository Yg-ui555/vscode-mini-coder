/**
 * app 侧的 API 客户端。
 */
const { apiVersion } = require('../../../core/src');

/** 请求头 */
function headers(token) {
  return { 'x-api-version': apiVersion(), authorization: token ? 'Bearer ' + token : '' };
}

/** 拼请求地址 */
function url(path, query) {
  const q = query ? '?' + query : '';
  return '/api' + path + q;
}

module.exports = { headers, url };
