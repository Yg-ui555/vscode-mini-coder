/**
 * handler: user-41
 * 用户资料相关接口。
 */

const { formatUserId } = require('../core/user-id');

function handle(request) {
  return {
    status: 200,
    body: { label: formatUserId(request.user) },
  };
}

module.exports = { handle };
