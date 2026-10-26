/**
 * handler: report-07
 * 报表相关接口。
 */

function handle(request) {
  const q = request.query || {};
  return {
    status: 200,
    body: { range: q.range || 'today', rows: q.rows || [] },
  };
}

module.exports = { handle };
