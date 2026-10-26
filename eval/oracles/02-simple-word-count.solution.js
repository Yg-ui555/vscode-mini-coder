/**
 * 02-simple-word-count 的标准答案
 *
 * ⭐ 这份文件的作用是【证明这道题可解】：
 *   verifySolvable.ts 会把 initial/ 复制到沙箱、执行本文件、再跑全部 case，
 *   要求一个 case 都不挂。
 *
 * 标准答案的写法：把"切词"换成一条流水线 —— 按空白切 → 转小写 → 剥标点 → 丢空词。
 * countUniqueWords 一个字都不用改：它本来就是调 countWords 的，
 * 跟着新逻辑走是自动的（这正是 task.md 特意点名的一条）。
 *
 * ⚠️ 这道题最容易漏的边界：
 *   · 空串 / 纯空白 / 连续空白都不能产生空字符串 key
 *   · 剥完标点变空的词要丢弃（单独一个 ',' 不该被计数）
 *   · null / undefined / 数字必须返回 {}，而且不能抛异常
 *   · 只出现一次的 key 仍然是字符串，不能图省事一律改成数组
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  taskId: '02-simple-word-count',

  apply(dir) {
    fs.writeFileSync(
      path.join(dir, 'wordcount.js'),
      [
        '/**',
        ' * 统计文本里的词频',
        ' *',
        ' * 典型用法：',
        " *   const { countWords } = require('./wordcount');",
        " *   countWords('a b a');   // => { a: 2, b: 1 }",
        ' *',
        ' * 约定：返回对象的 key 就是词，value 是这个词出现的次数。',
        ' */',
        '',
        '/** 要从词里剥掉的标点（task.md 明确列出来的这些） */',
        "const PUNCTUATION = /[.,!?;:\"'()\\[\\]{}]/g;",
        '',
        '/**',
        ' * 统计每个词出现了多少次',
        ' * @param {string} text',
        ' * @returns {Object<string, number>}',
        ' */',
        'function countWords(text) {',
        '  // 非字符串（null / undefined / 数字）直接返回空表，不抛异常',
        "  if (typeof text !== 'string') {",
        '    return {};',
        '  }',
        '',
        '  const counts = {};',
        '  // 按空白切分：空格 / 制表符 / 换行都算分隔符，连续空白不会切出空词',
        '  for (const raw of text.split(/\\s+/)) {',
        '    // 转小写 + 剥标点：两件事都得做，顺序无所谓',
        "    const word = raw.toLowerCase().replace(PUNCTUATION, '');",
        '    // 剥完标点变空的词直接丢弃',
        '    if (!word) continue;',
        '    counts[word] = (counts[word] || 0) + 1;',
        '  }',
        '  return counts;',
        '}',
        '',
        '/**',
        ' * 一共有多少个不同的词',
        ' * @param {string} text',
        ' * @returns {number}',
        ' */',
        'function countUniqueWords(text) {',
        '  const counts = countWords(text);',
        '  return Object.keys(counts).length;',
        '}',
        '',
        'module.exports = { countWords, countUniqueWords };',
        '',
      ].join('\n'),
      'utf-8'
    );
  },
};
