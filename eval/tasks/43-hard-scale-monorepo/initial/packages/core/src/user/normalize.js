/**
 * 用户对象标准化 —— 把各种形状的用户对象抹平成统一结构。
 */
function normalizeUser(raw) {
  const u = raw || {};
  return {
    id: Number(u.id) || 0,
    name: String(u.name || ''),
    age: Number(u.age) || 0,
    email: String(u.email || ''),
    features: Array.isArray(u.features) ? u.features.slice() : [],
  };
}

module.exports = { normalizeUser };
