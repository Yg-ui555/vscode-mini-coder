/**
 * 03-simple-off-by-one 的标准答案
 *
 * ⭐ 这份文件的作用是【证明这道题可解】：
 *   verifySolvable.ts 会把 initial/ 复制到沙箱、执行本文件、再跑全部 case，
 *   要求一个 case 都不挂。
 *
 * 标准答案的写法：把 end + 1 改成 end，并把"入参不是数组"的兜底补上。
 *
 * ⚠️ 这道题最容易漏的边界：
 *   · start == end 是空区间（[]），不是"取到一个元素"
 *   · end 超出长度要截断到数组末尾，start > end 要返回空数组（不能交换两个下标）
 *   · 入参不是数组（null / undefined / 数字 / 字符串）时返回 []，不能抛异常
 *   · 不能修改传入的数组（调用方还留着那个数组要用）
 *   · firstAndLast 本来就是对的，一个字都不用碰
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  taskId: '03-simple-off-by-one',

  apply(dir) {
    fs.writeFileSync(
      path.join(dir, 'slice.js'),
      [
        '/**',
        ' * 取数组的一段',
        ' *',
        ' * 典型用法：',
        " *   const { sliceRange } = require('./slice');",
        ' *   sliceRange([10, 20, 30, 40], 1, 3);   // 期望 [20, 30]',
        ' *',
        " * 约定：start / end 都是下标，从 0 开始数；end 的含义跟原生 slice 一样（不含）。",
        ' */',
        '',
        '/**',
        ' * 取数组的一段',
        ' * @param {Array} arr',
        ' * @param {number} start 起始下标',
        ' * @param {number} end   结束下标（不含）',
        ' * @returns {Array}',
        ' */',
        'function sliceRange(arr, start, end) {',
        '  // 传入的不是数组：返回空数组，不能抛异常',
        '  if (!Array.isArray(arr)) {',
        '    return [];',
        '  }',
        '',
        '  // end 不含（跟原生 slice 一样）：原来的 end + 1 会多取一个元素。',
        '  // start > end 返回空数组、end 超出长度自动截断，这两条直接交给原生实现 ——',
        '  // 自己再实现一遍边界，等于给自己留一个写第二个差一错误的机会。',
        '  return arr.slice(start, end);',
        '}',
        '',
        '/**',
        ' * 取数组的第一个和最后一个元素',
        ' * @param {Array} arr',
        ' * @returns {Array|null} 长度为 2 的数组；空数组返回 null',
        ' */',
        'function firstAndLast(arr) {',
        '  if (arr.length === 0) return null;',
        '  return [arr[0], arr[arr.length - 1]];',
        '}',
        '',
        'module.exports = { sliceRange, firstAndLast };',
        '',
      ].join('\n'),
      'utf-8'
    );
  },
};
