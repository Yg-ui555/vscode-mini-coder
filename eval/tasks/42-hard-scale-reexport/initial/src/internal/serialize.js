/**
 * 序列化 —— 把内部结构转成对外的 JSON 形状。
 */

/** 把 record 转成对外形状 */
function serialize(record) {
  if (!record) return null;
  return { id: record.id, title: record.title, at: record.at };
}

module.exports = { serialize };
