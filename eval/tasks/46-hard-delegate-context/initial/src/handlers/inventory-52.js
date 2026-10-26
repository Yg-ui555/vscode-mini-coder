/**
 * handler: inventory-52
 * 库存相关接口。
 */

const { formatUserId } = require('../core/user-id');

function renderOwner(owner) {
  return `归属人: ${formatUserId(owner)}`;
}

function handle(request) {
  return {
    status: 200,
    body: { text: renderOwner(request.owner) },
  };
}

module.exports = { handle };
