/**
 * 随机数适配层 —— 可注入种子，保证评测可复现。
 */
let seed = 42;

/** 设置种子 */
function setSeed(value) {
  seed = value >>> 0;
}

/**
 * 生成 [0, 1) 的伪随机数（线性同余）。
 *
 * ⚠️ 不用 Math.random()：评测要能复现，
 *    同样的输入必须得到同样的输出。
 */
function next() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

/** [min, max] 之间的整数 */
function int(min, max) {
  return min + Math.floor(next() * (max - min + 1));
}

module.exports = { setSeed, next, int };
