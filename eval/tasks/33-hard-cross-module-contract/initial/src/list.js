/**
 * 列表渲染
 *
 * ⚠️ 本题目标：适配新的记录结构。
 *
 * ⭐ 这里有【两条】依赖路径，都得改：
 *   1. 间接：调用了 formatRecord（它读记录字段）
 *   2. 直接：排序时自己读了 rec.name
 *
 *   只改一条，另一条照样炸 —— 这正是"跨模块契约"难的地方。
 */

const { formatRecord } = require('./format');
const { listRecords } = require('./records');

function renderList() {
  return listRecords()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((r) => formatRecord(r));
}

module.exports = { renderList };
