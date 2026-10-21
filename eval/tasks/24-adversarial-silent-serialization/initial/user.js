/**
 * 用户模型
 */
class User {
  constructor(id, name) {
    this.id = id;
    this.name = name;
  }

  // 手写序列化——加新字段时容易漏掉
  toJSON() {
    return { id: this.id, name: this.name };
  }
}

function saveUser(u) {
  return JSON.stringify(u);
}
module.exports = { User, saveUser };