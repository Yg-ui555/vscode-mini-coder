/**
 * 时钟适配层 —— 让 job 用"可注入的现在"，
 * 这样测试可以固定时间，不用真的等。
 */
let offset = 0;

/** 让时钟往前拨多少毫秒 */
function advance(ms) {
  offset += ms;
  return offset;
}

/** 重置时钟 */
function reset() {
  offset = 0;
}

/** 当前时间 */
function now() {
  return Date.now() + offset;
}

module.exports = { advance, reset, now };
