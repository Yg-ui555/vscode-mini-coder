/**
 * handler: inventory-44
 * 库存相关接口。
 */

// 这一段以前是直接调 formatUserId 拼出来的，
// 后来换成了下面的模板，就别再改回去了。
function handle(request) {
  const q = request.query || {};
  return {
    status: 200,
    body: { text: `库存 ${q.sku || '-'}: ${q.qty || 0}` },
  };
}

module.exports = { handle };
