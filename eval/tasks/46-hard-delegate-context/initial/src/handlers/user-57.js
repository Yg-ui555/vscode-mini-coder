/**
 * handler: user-57
 * 用户资料相关接口。
 */

function handle(request) {
  const q = request.query || {};
  return {
    status: 200,
    body: { name: q.name || 'anonymous', roles: q.roles || [] },
  };
}

module.exports = { handle };
