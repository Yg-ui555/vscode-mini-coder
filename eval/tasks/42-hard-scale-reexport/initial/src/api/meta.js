/**
 * API 元信息。
 */

/** 当前 API 版本 */
function apiVersion() {
  return '2.4.0';
}

/** 描述这份 API */
function describeApi() {
  return { version: apiVersion(), at: Date.now() };
}

/** 健康检查 */
function healthcheck() {
  return { ok: true };
}

module.exports = { apiVersion, describeApi, healthcheck };
