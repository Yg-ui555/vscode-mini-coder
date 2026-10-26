/**
 * 13-hard-perf-optimize 的标准答案
 *
 * ⭐ 这份文件的作用是【证明这道题可解】：
 *   verifySolvable.ts 会把 initial/ 复制到沙箱、执行本文件、再跑全部 case，
 *   要求一个 case 都不挂。
 *
 * 标准答案的写法：
 *   1. topN 的 O(n²) 交换排序换成 O(n log n) 排序
 *   2. 新增 topNWithCount(arr, n) -> [[元素, 次数], ...]
 *
 * ⚠️ 本题的核心陷阱是【不要把 topNWithCount 的排序规则偷偷套到 topN 上】：
 *   topNWithCount 次数相同时按字典序升序，topN 不要求 —— 次数相同保持首次出现顺序。
 *
 * 为什么要显式带上「首次出现的下标」做 tiebreaker：
 *   check.js 钉死了 topN(['z','a','z','a'], 2) === ['z','a']，
 *   也就是次数相同时保持 Map 的插入顺序（= 首次出现顺序）。
 *   依赖引擎 sort 的稳定性是「碰巧对」，显式写下标才是「一定对」。
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  taskId: '13-hard-perf-optimize',

  apply(dir) {
    fs.writeFileSync(
      path.join(dir, 'dedupe.js'),
      [
        '/**',
        ' * 从大数组里找出现次数最多的元素',
        ' */',
        '',
        '/**',
        ' * 统计每个元素出现了多少次（Map 天然保持首次出现顺序）',
        ' * @param {Array} arr',
        ' * @returns {Map}',
        ' */',
        'function countOccurrences(arr) {',
        '  const counts = new Map();',
        '  for (const item of arr) {',
        '    counts.set(item, (counts.get(item) || 0) + 1);',
        '  }',
        '  return counts;',
        '}',
        '',
        '// 返回出现次数最多的前 n 个元素（只返回元素，不含次数）',
        'function topN(arr, n) {',
        '  const counts = countOccurrences(arr);',
        '  // 带上首次出现的下标做 tiebreaker：',
        '  //   次数降序；次数相同则保持首次出现顺序（= Map 的插入顺序）',
        '  const entries = Array.from(counts.entries()).map((e, i) => [e[0], e[1], i]);',
        '  entries.sort((a, b) => b[1] - a[1] || a[2] - b[2]);',
        '  return entries.slice(0, n).map((e) => e[0]);',
        '}',
        '',
        '/**',
        ' * 返回出现次数最多的前 n 个元素，同时带上次数',
        ' *',
        ' * ⚠️ 排序规则比 topN 严格：次数相同时按元素的字典序升序。',
        ' *    topN 不做这个 tiebreaker —— 两个函数的语义不一样，别互相污染。',
        ' * @param {Array} arr',
        ' * @param {number} n',
        ' * @returns {Array<[any, number]>}',
        ' */',
        'function topNWithCount(arr, n) {',
        '  const counts = countOccurrences(arr);',
        '  const entries = Array.from(counts.entries()).map((e, i) => [e[0], e[1], i]);',
        '  entries.sort((a, b) => {',
        '    if (b[1] !== a[1]) return b[1] - a[1];',
        '    // 次数相同：按元素的字典序升序（\'a\' < \'b\'）',
        '    const x = String(a[0]);',
        '    const y = String(b[0]);',
        '    if (x === y) return a[2] - b[2];',
        '    return x < y ? -1 : 1;',
        '  });',
        '  return entries.slice(0, n).map((e) => [e[0], e[1]]);',
        '}',
        '',
        'module.exports = { topN, topNWithCount };',
        '',
      ].join('\n'),
      'utf-8'
    );
  },
};
