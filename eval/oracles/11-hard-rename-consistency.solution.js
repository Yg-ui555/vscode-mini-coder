/**
 * 11-hard-rename-consistency 的标准答案
 *
 * ⭐ 这份文件的作用是【证明这道题可解】：
 *   verifySolvable.ts 会把 initial/ 复制到沙箱、执行本文件、再跑全部 case，
 *   要求一个 case 都不挂。
 *
 * 标准答案的写法：把三个文件里所有【独立的】Circle / Square 整体换成新名字。
 *
 * ⚠️ 这道题最容易漏的地方（少改一处就挂）：
 *   · shapes.js：类声明 + scale() 里的自引用 new Circle(...) + module.exports
 *   · report.js：顶部解构 require + buildFromNames() 里的两处 new
 *   · index.js：顶部解构 require + demoShapes() 里的三处 new
 *
 * 为什么用「单词边界」而不是裸字符串替换：
 *   check.js 判残留用的是 /\bCircle\b/ / \bSquare\b/（大小写敏感），
 *   所以小写的 'circle' / 'square' 业务标签不受影响；
 *   但裸替换会把这些标签一起改掉 —— 报表输出就变了，回归守卫立刻挂。
 *   带 \b 的正则只命中独立标识符，既不漏也不误伤。
 */

const fs = require('fs');
const path = require('path');

/** 三个必须一起改的文件 —— 少改一个都会留下旧名字 */
const FILES = ['shapes.js', 'report.js', 'index.js'];

module.exports = {
  taskId: '11-hard-rename-consistency',

  apply(dir) {
    for (const rel of FILES) {
      const file = path.join(dir, rel);
      const src = fs.readFileSync(file, 'utf-8');
      const next = src.replace(/\bCircle\b/g, 'RoundShape').replace(/\bSquare\b/g, 'QuadShape');

      if (next === src) {
        throw new Error(
          `标准答案失效：${rel} 里没找到旧名字，initial/ 变了，需要同步更新这份 oracle`
        );
      }
      fs.writeFileSync(file, next, 'utf-8');
    }
  },
};
