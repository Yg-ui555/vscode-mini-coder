/**
 * 计算订单总价
 */

// 这个函数同时存在多个可优化方向：
// - 时间复杂度（当前 O(n²)）
// - 可读性
// - 内存占用
function calcPrice(items) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      if (items[i].category === items[j].category) {
        total += items[j].price;
      }
    }
  }
  return total;
}

module.exports = { calcPrice };