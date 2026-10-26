/**
 * job 注册表 —— kind → run 函数的映射。
 *
 * ⚠️ 这里【不做任何归一化】：run 返回什么就透传什么。
 *    归一化是 contract 层的事，由各个 job 自己负责。
 *    这么分是为了"谁没遵守契约"能一眼定位到具体文件。
 */
const handlers = new Map();

/** 注册一个 job */
function register(kind, run) {
  if (typeof kind !== 'string' || !kind) {
    throw new TypeError('register(kind, run)：kind 必须是非空字符串');
  }
  if (typeof run !== 'function') {
    throw new TypeError('register(kind, run)：run 必须是函数');
  }
  handlers.set(kind, run);
}

/** 取一个 job，取不到返回 undefined */
function get(kind) {
  return handlers.get(kind);
}

/** 当前注册的全部 kind（排序后返回，方便对比） */
function kinds() {
  return Array.from(handlers.keys()).sort();
}

/**
 * 按 kind 分发。
 *
 * ⚠️ 找不到 kind 时抛错，而不是返回 undefined ——
 *   让"调错了"变成一个响亮的失败，而不是后面某处 undefined.xxx 的哑错误。
 */
function dispatch(kind, input) {
  const run = handlers.get(kind);
  if (!run) throw new Error('Unknown job kind: ' + kind);
  return run(input);
}

module.exports = { register, get, kinds, dispatch };
