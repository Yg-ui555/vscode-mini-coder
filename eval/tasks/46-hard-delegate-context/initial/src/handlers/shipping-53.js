/**
 * handler: shipping-53
 * 物流相关接口。
 */

const userId = require('../core/user-id');

function handle(request) {
  return {
    status: 200,
    body: { label: userId.formatUserId(request.user) },
  };
}

module.exports = { handle };
