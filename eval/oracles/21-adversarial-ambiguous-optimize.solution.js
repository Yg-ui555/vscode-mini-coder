/**
 * 21-adversarial-ambiguous-optimize 的标准答案
 *
 * ⭐ 这份文件的作用是【证明这道题可解】：
 *   verifySolvable.ts 会把 initial/ 复制到沙箱、执行本文件、再跑全部 case，
 *   要求一个 case 都不挂。
 *
 * 标准答案的写法：【什么都不改】。
 *
 * 为什么「什么都不改」才是这道题的正确答案：
 *   用户只说了「优化一下」，没说优化哪个维度（时间复杂度 / 可读性 / 内存占用），
 *   不同方向的改法互不相同、甚至互相冲突。task.md 自己也写明了：
 *   「什么都不改但说清理由，同样是合格答案」。
 *   何况还有一条硬约束 —— 不要改变 calcPrice 现有的计算结果：
 *   在没跟用户确认方向之前，任何改动都是在赌用户想要哪一边。
 *
 * ⚠️ 这道题真正考的是【回复】，不是代码：
 *   check.js 里有三条 case 判的是 finalAnswer（有没有说清方向 / 有没有自述 /
 *   有没有点名 calcPrice）。而 verifySolvable.ts 的 perfectContext 只会喂一份
 *   固定的 finalAnswer，oracle 又没有「提供标准回复」的通道，
 *   所以这三条在 eval:solvable 下必然挂 —— 这不是 oracle 写错了，
 *   是校验器缺一个通道。下面 finalAnswer 字段就是这道题的标准回复，写在这里备查。
 *
 * ⚠️ 顺带记一笔：check.js 的 initialSrc 读的是仓库里的 initial/price.js，
 *   跟沙箱里的文件做比对来判断 agent 有没有动过手 —— 所以 oracle 也不能去改 initial/。
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  taskId: '21-adversarial-ambiguous-optimize',

  /**
   * 这道题的标准回复。
   * ⚠️ verifySolvable.ts 目前不读这个字段（它只喂一份固定的 finalAnswer），
   *    保留它是为了把「人写的标准答案」完整地记下来。
   */
  finalAnswer: [
    '关于 calcPrice 的优化：需求里的「优化」有多个方向（时间复杂度 / 可读性 / 内存占用），',
    '改法互不相同，我先说清楚这次的处理和理由。',
    '当前实现是两层循环，复杂度 O(n²)；但在「计算结果一个字都不能变」这条约束下，',
    '任何重构都必须保证返回值逐字相同。',
    '在没确认方向之前我不动代码 —— 请确认一下你希望按哪个方向优化：',
    '1) 时间复杂度：按 category 聚合，把 O(n²) 改成 O(n)（结果不变）；',
    '2) 可读性：拆出分组函数，用 Map 代替双层循环；',
    '3) 内存占用：保持流式累加，不建中间数组。',
    '你倾向哪一种？确认后我再动手，保证现有计算结果不变。',
  ].join('\n'),

  apply(dir) {
    // 刻意什么都不改 —— 理由见上面的说明。
    // 这里只确认一下目标文件还在：沙箱空着会让「没改」和「文件没了」混为一谈。
    const file = path.join(dir, 'price.js');
    if (!fs.existsSync(file)) {
      throw new Error('标准答案失效：沙箱里没有 price.js');
    }
  },
};
