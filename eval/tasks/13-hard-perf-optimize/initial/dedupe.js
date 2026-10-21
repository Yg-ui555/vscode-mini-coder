/**
 * 从大数组里找出现次数最多的元素
 */

// 返回出现次数最多的前 n 个元素（只返回元素，不含次数）
function topN(arr, n) {
  const counts = new Map();
  for (const item of arr) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }

  const entries = Array.from(counts.entries());

  // O(n²) 冒泡排序
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[j][1] > entries[i][1]) {
        const tmp = entries[i];
        entries[i] = entries[j];
        entries[j] = tmp;
      }
    }
  }

  return entries.slice(0, n).map((e) => e[0]);
}

module.exports = { topN };