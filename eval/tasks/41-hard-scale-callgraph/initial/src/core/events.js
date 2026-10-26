/**
 * 极简事件总线 —— job 跑完发个信号，方便上层挂钩子。
 */
const handlers = new Map();

/** 订阅事件 */
function on(event, fn) {
  if (!handlers.has(event)) handlers.set(event, []);
  handlers.get(event).push(fn);
  return () => off(event, fn);
}

/** 退订 */
function off(event, fn) {
  const list = handlers.get(event);
  if (!list) return;
  const i = list.indexOf(fn);
  if (i !== -1) list.splice(i, 1);
}

/**
 * 触发事件。
 *
 * ⚠️ 单个订阅者抛错不能影响其他订阅者 ——
 *   通知失败不该把业务流程带崩。
 */
function emit(event, payload) {
  const list = handlers.get(event) || [];
  for (const fn of list.slice()) {
    try {
      fn(payload);
    } catch (e) {
      // 订阅者的错误不该冒泡
    }
  }
  return list.length;
}

module.exports = { on, off, emit };
