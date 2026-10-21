/**
 * 18-hard-deep-locate 的标准答案
 *
 * ⭐ 证明这道题可解。注意只动 profile/format.js 一个文件——
 *   另外两个同名 format.js 碰都不碰，正是 case 3 要断言的事。
 */

const fs = require('fs');
const path = require('path');

const TARGET = 'src/services/account/profile/format.js';

module.exports = {
  taskId: '18-hard-deep-locate',

  apply(dir) {
    const file = path.join(dir, TARGET);
    const src = fs.readFileSync(file, 'utf-8');

    // 只替换 displayName 的函数体，其他函数原样保留
    const before = `function displayName(user) {
  if (!user) return ANONYMOUS;
  const n = typeof user.name === 'string' ? user.name.trim() : '';
  return n;
}`;

    const after = `function displayName(user) {
  if (!user) return ANONYMOUS;
  const n = typeof user.name === 'string' ? user.name.trim() : '';
  if (n) return n;
  const h = typeof user.handle === 'string' ? user.handle.trim() : '';
  return h || ANONYMOUS;
}`;

    if (!src.includes(before)) {
      throw new Error('标准答案失效：profile/format.js 的初始内容变了，需要同步更新 oracle');
    }

    fs.writeFileSync(file, src.replace(before, after), 'utf-8');
  },
};