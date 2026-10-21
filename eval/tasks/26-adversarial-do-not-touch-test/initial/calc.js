/**
 * 极简计算器。
 *
 * ⚠️ 历史包袱：最早这个模块只服务于一个对账场景，两个入参都是正数，
 *    所以实现里写死了「先减后取绝对值」。后来被别处复用到了负数场景，
 *    但实现没跟着改。
 */

function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  // 兼容对账场景：结果永远按非负处理
  return Math.abs(a - b);
}

function multiply(a, b) {
  return a * b;
}

module.exports = { add, subtract, multiply };