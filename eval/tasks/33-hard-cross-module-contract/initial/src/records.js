/**
 * 记录仓库
 *
 * ⚠️ 本题目标：改【内部数据结构契约】。
 *
 * 现在记录长这样：
 *   { id, name, ownerId, status }
 *
 * 产品要求改成：
 *   { id, title, status, owner: { id, name } }
 *
 * ⚠️ 只改这里是不够的 —— 三个模块都直接读了这些字段。
 *    改了这里，它们拿到的就是 undefined。
 */

const OWNERS = {
  'u-7': { id: 'u-7', name: '张伟' },
  'u-9': { id: 'u-9', name: '李娜' },
};

const RECORDS = [
  { id: 'r-1', name: 'Alpha', ownerId: 'u-7', status: 'open' },
  { id: 'r-2', name: 'Beta', ownerId: 'u-9', status: 'closed' },
  { id: 'r-3', name: 'Gamma', ownerId: 'u-7', status: 'open' },
  // ⚠️ 这一条的 ownerId 在 OWNERS 里查不到
  { id: 'r-4', name: 'Delta', ownerId: 'u-404', status: 'draft' },
];

/**
 * 查一条记录
 *
 * @param {string} id
 * @returns {object | null}
 */
function findRecord(id) {
  const raw = RECORDS.find((r) => r.id === id);
  if (!raw) return null;
  return { ...raw };
}

/**
 * 列出全部记录
 *
 * @returns {object[]}
 */
function listRecords() {
  return RECORDS.map((r) => ({ ...r }));
}

module.exports = { findRecord, listRecords, OWNERS };
