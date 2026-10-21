/**
 * 内存存储
 */

// 全局单例
const instance = {
  data: new Map(),
  get(k) { return this.data.get(k); },
  set(k, v) { this.data.set(k, v); },
};

function getStore() {
  return instance;
}
module.exports = { getStore };