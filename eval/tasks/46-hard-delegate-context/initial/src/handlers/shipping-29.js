/**
 * handler: shipping-29
 * 物流相关接口。
 */

function handle(request) {
  const q = request.query || {};
  return {
    status: 200,
    body: { waybill: q.waybill || null, carrier: q.carrier || 'unknown' },
  };
}

module.exports = { handle };
