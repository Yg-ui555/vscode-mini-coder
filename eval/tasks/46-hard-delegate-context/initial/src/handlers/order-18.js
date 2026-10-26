/**
 * handler: order-18
 * 订单相关接口。
 */

function handle(request) {
  const q = request.query || {};
  return {
    status: 200,
    body: { orderId: q.orderId || null, state: q.state || 'new' },
  };
}

module.exports = { handle };
