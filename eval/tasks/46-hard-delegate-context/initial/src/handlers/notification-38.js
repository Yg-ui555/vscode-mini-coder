/**
 * handler: notification-38
 * 站内通知相关接口。
 */

function handle(request) {
  const q = request.query || {};
  return {
    status: 200,
    body: { sent: q.sent === true, channel: q.channel || 'none' },
  };
}

module.exports = { handle };
