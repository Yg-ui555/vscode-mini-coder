/**
 * handler: inventory-20
 * 库存相关接口。
 */

function handle(request) {
  const q = request.query || {};
  return {
    status: 200,
    body: { sku: q.sku || null, qty: q.qty || 0 },
  };
}

module.exports = { handle };
