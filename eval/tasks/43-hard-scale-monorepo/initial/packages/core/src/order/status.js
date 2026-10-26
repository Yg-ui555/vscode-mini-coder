/**
 * 订单状态流转。
 */
const FLOW = ['created', 'paid', 'packed', 'shipped', 'done', 'cancelled'];

/** 下一个状态 */
function nextStatus(status) {
  const i = FLOW.indexOf(status);
  if (i === -1 || i === FLOW.length - 1) return null;
  return FLOW[i + 1];
}

/** 是否是终态 */
function isFinal(status) {
  return status === 'done' || status === 'cancelled';
}

module.exports = { nextStatus, isFinal, FLOW };
