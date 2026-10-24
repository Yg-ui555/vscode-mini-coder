/**
 * 对外 API 适配层
 *
 * ⚠️ 本题目标：适配新的记录结构。
 *
 * ⭐⭐ 本模块是本题最关键的地方：
 *
 *    对外 API 的【形状一个字都不许变】！
 *    外部系统拿到的一直是 { id, title, ownerId }，
 *    内部记录结构改了，但对外契约不能跟着变。
 *
 *    所以这里只是"取值的来源"变了，"取的字段"没变：
 *      rec.name    →  rec.title
 *      rec.ownerId →  rec.owner.id
 */

function toApiPayload(rec) {
  return {
    id: rec.id,
    title: rec.name,
    ownerId: rec.ownerId,
  };
}

module.exports = { toApiPayload };
