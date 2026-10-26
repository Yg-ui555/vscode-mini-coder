/**
 * handler: auth-48
 * 鉴权相关接口。
 */

function handle(request) {
  const q = request.query || {};
  return {
    status: 200,
    body: { token: q.token || null, scopes: q.scopes || [] },
  };
}

module.exports = { handle };
