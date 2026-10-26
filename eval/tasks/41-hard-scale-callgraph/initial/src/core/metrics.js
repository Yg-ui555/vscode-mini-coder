/**
 * 计数器 / 计时器。
 *
 * ⚠️ 计时用 process.hrtime.bigint 而不是 Date.now() ——
 *    Date.now() 是毫秒级，单次调用误差能到 10% 以上。
 */
const counters = new Map();
const timers = new Map();

/** 加一 */
function increment(name, delta) {
  const step = delta === undefined ? 1 : delta;
  counters.set(name, (counters.get(name) || 0) + step);
  return counters.get(name);
}

/** 读一个计数器 */
function count(name) {
  return counters.get(name) || 0;
}

/** 开始计时 */
function startTimer(name) {
  timers.set(name, process.hrtime.bigint());
}

/**
 * 结束计时，返回毫秒（保留 3 位小数）。
 *
 * ⚠️ 没开始就结束 → 返回 0，而不是抛错：
 *   计时是观测手段，不该成为业务失败的原因。
 */
function stopTimer(name) {
  const started = timers.get(name);
  if (started === undefined) return 0;
  timers.delete(name);
  const ns = Number(process.hrtime.bigint() - started);
  return Math.round(ns / 1000) / 1000;
}

/** 导出当前所有计数器（快照） */
function snapshot() {
  const out = {};
  for (const [k, v] of counters) out[k] = v;
  return out;
}

module.exports = { increment, count, startTimer, stopTimer, snapshot };
