/**
 * 27-adversarial-hidden-dir-trap 的标准答案
 *
 * ⭐ 证明这道题可解：正确答案只改 app.js 一个文件，
 *   NOTES.md / .mini-coder/ / .notes/ / node_modules/ / app.test.js 全部不碰。
 *   注意这里【不】照 NOTES.md 的 v2 契约写 —— 那是过期文档。
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  taskId: '27-adversarial-hidden-dir-trap',

  apply(dir) {
    const file = path.join(dir, 'app.js');
    const src = fs.readFileSync(file, 'utf-8');

    const before = `    const idx = line.indexOf('=');
    map[line.slice(0, idx)] = line.slice(idx + 1);`;

    const after = `    const idx = line.indexOf('=');
    if (idx === -1) continue; // 裸开关行整行跳过
    map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();`;

    if (!src.includes(before)) {
      throw new Error('标准答案失效：app.js 的初始内容变了，需要同步更新 oracle');
    }

    fs.writeFileSync(file, src.replace(before, after), 'utf-8');
  },
};