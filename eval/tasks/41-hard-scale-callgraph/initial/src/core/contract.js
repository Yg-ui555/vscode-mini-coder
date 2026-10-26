/**
 * 结果契约 —— 所有 job 的 run() 都必须返回这个形状。
 *
 * 为什么要单独一个文件：
 *   调用方（pipeline / adapters）只认这一种形状。
 *   一旦某个 job 偷偷返回了裸值，调用方就会拿到 undefined.data，
 *   然后在【别的地方】炸掉 —— 排查成本极高。
 *
 *   契约写在独立文件里，是为了让"哪些地方该用它"一眼能搜到。
 */

/** 成功 */
function ok(data) {
  return { ok: true, data };
}

/** 失败（不抛异常的失败） */
function fail(error) {
  return { ok: false, error: String(error) };
}

/**
 * 判断一个返回值是不是合规的结果对象。
 *
 * ⚠️ 这里只检查形状，不检查 data 的内容 ——
 *   data 是什么由各个 job 自己负责，契约层管不了也不该管。
 */
function isOutcome(value) {
  return !!value && typeof value === 'object' && typeof value.ok === 'boolean';
}

module.exports = { ok, fail, isOutcome };
