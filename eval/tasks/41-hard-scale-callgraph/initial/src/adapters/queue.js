/**
 * 队列适配层 —— 把待办 job 排进队列。
 *
 * ⚠️ 沙箱里没有真正的消息队列，这里用一个内存数组模拟。
 */
const pending = [];

/** 入队 */
function enqueue(kind, payload) {
  pending.push({ kind, payload, at: Date.now() });
  return pending.length;
}

/** 出队（先进先出） */
function dequeue() {
  return pending.shift() || null;
}

/** 队列长度 */
function size() {
  return pending.length;
}

module.exports = { enqueue, dequeue, size };
