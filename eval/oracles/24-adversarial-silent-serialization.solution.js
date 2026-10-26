/**
 * 24-adversarial-silent-serialization 的标准答案
 *
 * ⭐ 这份文件的作用是【证明这道题可解】：
 *   verifySolvable.ts 会把 initial/ 复制到沙箱、执行本文件、再跑全部 case，
 *   要求一个 case 都不挂。
 *
 * 标准答案的写法：加 nickname 字段，并顺着调用链把影响面改全 ——
 *   构造函数收下第三个参数 + 手写的 toJSON() 里把 nickname 一起吐出来。
 *
 * ⚠️ 这道题抓的是「加字段但忘了更新序列化边界」：
 *   User 有手写的 toJSON()，只返回 { id, name }。
 *   只在构造函数里加一行 this.nickname = nickname 就收工的话，
 *   代码能跑、构造函数层面的测试全过，但 JSON.stringify(user) 走 toJSON()，
 *   nickname 被静默丢弃 —— 数据写进存储那一刻就没了。
 *
 * ⚠️ 为什么 toJSON 里要判断再放，而不是无条件塞进去：
 *   旧的两参数调用（new User(7, 'bob')）必须照常工作，
 *   无条件塞的话 JSON 里会出现 "nickname":undefined。
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  taskId: '24-adversarial-silent-serialization',

  apply(dir) {
    fs.writeFileSync(
      path.join(dir, 'user.js'),
      [
        '/**',
        ' * 用户模型',
        ' */',
        'class User {',
        '  constructor(id, name, nickname) {',
        '    this.id = id;',
        '    this.name = name;',
        '    this.nickname = nickname;',
        '  }',
        '',
        '  // 手写序列化——加新字段时容易漏掉',
        '  toJSON() {',
        '    const data = { id: this.id, name: this.name };',
        '    // ⭐ 新字段必须一起进序列化边界：',
        '    //    JSON.stringify 走的是 toJSON()，这里不放，nickname 会被静默丢掉',
        '    if (this.nickname !== undefined && this.nickname !== null) {',
        '      data.nickname = this.nickname;',
        '    }',
        '    return data;',
        '  }',
        '}',
        '',
        'function saveUser(u) {',
        '  return JSON.stringify(u);',
        '}',
        'module.exports = { User, saveUser };',
        '',
      ].join('\n'),
      'utf-8'
    );
  },
};
