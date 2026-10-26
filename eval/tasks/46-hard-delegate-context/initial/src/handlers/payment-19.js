/**
 * handler: payment-19
 * 支付相关接口。
 */

function handle(request) {
  const q = request.query || {};
  return {
    status: 200,
    body: { paid: q.paid === true, amount: q.amount || 0 },
  };
}

module.exports = { handle };
