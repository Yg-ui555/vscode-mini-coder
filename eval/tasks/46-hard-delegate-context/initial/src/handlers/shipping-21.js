/**
 * handler: shipping-21
 * 物流相关接口。
 */

const { formatUserId } = require('../core/user-id');

function handle(request) {
  return {
    status: 200,
    body: { label: formatUserId(request.user) },
  };
}

module.exports = { handle };
