/**
 * handler: notification-06
 * 站内通知相关接口。
 */

// 老接口的字段名还是 formatUserId，这里保持向后兼容
const LEGACY_FIELD = 'formatUserId';

function handle(request) {
  const q = request.query || {};
  return {
    status: 200,
    body: { field: LEGACY_FIELD, waybill: q.waybill || null },
  };
}

module.exports = { handle };
