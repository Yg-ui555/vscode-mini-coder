/**
 * 04-simple-dedupe 的标准答案
 *
 * ⭐ 这份文件的作用是【证明这道题可解】：
 *   verifySolvable.ts 会把 initial/ 复制到沙箱、执行本文件、再跑全部 case，
 *   要求一个 case 都不挂。
 *
 * 标准答案的写法：keyFn 返回 undefined 时改用"元素本身"当 key，
 * 并且分两种情况处理 —— 对象按【引用】区分、原始值按【值】区分。
 *
 * ⚠️ 这道题最容易漏的边界：
 *   · null / 空串 / 0 都是有效 key，只有 undefined 才回退（这三个照样要去重）
 *   · 同一个对象引用出现两次仍然只保留一次（WeakSet 天然满足）
 *   · 缺字段的【不同】对象不能互相吞掉（这正是原 bug 的症状）
 *   · 原始值在 key 全是 undefined 时按值去重：[1, 1, 2] -> [1, 2]
 *   · 不能用"给每个元素编个递增下标"绕过问题 —— 那会让同一个对象重复出现时被当成两项
 *   · countBy 没有这个 bug，一个字都不用动
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  taskId: '04-simple-dedupe',

  apply(dir) {
    fs.writeFileSync(
      path.join(dir, 'dedupe.js'),
      [
        '/**',
        ' * 数组去重相关',
        ' *',
        ' * 典型用法：',
        " *   const { dedupeBy } = require('./dedupe');",
        ' *   dedupeBy([{ id: 1 }, { id: 2 }, { id: 1 }], (x) => x.id);   // => 两项',
        ' */',
        '',
        '/**',
        ' * 按 key 函数取出第一项（保留首次出现）',
        ' * @param {Array} arr',
        ' * @param {(item: any) => any} keyFn',
        ' * @returns {Array}',
        ' */',
        'function dedupeBy(arr, keyFn) {',
        '  // 传入的不是数组：返回空数组，不能抛异常',
        '  if (!Array.isArray(arr)) {',
        '    return [];',
        '  }',
        '',
        '  const seenKeys = new Set();        // 有效 key（keyFn 返回的不是 undefined）',
        '  const seenValues = new Set();      // key 缺失时：原始值按【值】去重',
        '  const seenObjects = new WeakSet(); // key 缺失时：对象按【引用】去重',
        '  const out = [];',
        '',
        '  for (const item of arr) {',
        '    const k = keyFn(item);',
        '    let duplicated;',
        '',
        '    if (k === undefined) {',
        '      // keyFn 返回 undefined：改用元素本身当 key。',
        '      // 对象按引用区分、原始值按值区分 ——',
        '      // 缺字段的不同对象才不会互相吞掉，这正是原 bug 的症状。',
        "      if (item !== null && typeof item === 'object') {",
        '        duplicated = seenObjects.has(item);',
        '        if (!duplicated) seenObjects.add(item);',
        '      } else {',
        '        duplicated = seenValues.has(item);',
        '        if (!duplicated) seenValues.add(item);',
        '      }',
        '    } else {',
        '      // null / 空串 / 0 都是有效 key，照常当 key 去重',
        '      duplicated = seenKeys.has(k);',
        '      if (!duplicated) seenKeys.add(k);',
        '    }',
        '',
        '    if (duplicated) continue;',
        '    out.push(item);',
        '  }',
        '  return out;',
        '}',
        '',
        '/**',
        ' * 按 key 函数分组计数',
        ' * @param {Array} arr',
        ' * @param {(item: any) => any} keyFn',
        ' * @returns {Object<string, number>}',
        ' */',
        'function countBy(arr, keyFn) {',
        '  const counts = {};',
        '  for (const item of arr) {',
        '    const k = keyFn(item);',
        '    counts[k] = (counts[k] || 0) + 1;',
        '  }',
        '  return counts;',
        '}',
        '',
        'module.exports = { dedupeBy, countBy };',
        '',
      ].join('\n'),
      'utf-8'
    );
  },
};
