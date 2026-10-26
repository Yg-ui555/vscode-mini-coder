/**
 * 标准答案 —— 44-hard-scale-perf-behavior
 *
 * 目的：证明这道题【有解】。
 *
 * 标准解法（改一个文件，两处）：
 *   src/analyzer.js
 *     1. ⭐ 词频统计：O(n²) 的朴素计数 → O(n) 的一次遍历
 *        （这是热路径 85% 的耗时来源）
 *     2. ⭐ 去掉末尾那次 JSON 深拷贝
 *        （stats 里的每个字段都是本次调用新建的，没有共享状态，
 *          那次拷贝纯属浪费 —— 而且它把整个输出又序列化了一遍）
 *
 * ⚠️ 【行为必须一模一样】—— 所以：
 *   · 词频表的【插入顺序】不能变
 *     （Map 保插入顺序，转成对象时按同一顺序插入 → Object.keys 顺序一致）
 *   · 同频词的排序不能变（stable sort，本来就没动）
 *   · 分词规则、缩写不切句、CJK 不分词…… 一个字都没改
 *
 * ⚠️ 下游模块（src/deps/）一个字节都不许动 ——
 *   它们依赖的是 analyzer 当前的行为，不是"应该有的行为"。
 */

const fs = require('fs');
const path = require('path');

/** 读改写 */
function patch(dir, rel, fn) {
  const p = path.join(dir, rel);
  const src = fs.readFileSync(p, 'utf-8');
  fs.writeFileSync(p, fn(src), 'utf-8');
}

/** 替换并校验锚点存在 */
function replaceOnce(src, from, to, where) {
  if (!src.includes(from)) {
    throw new Error(`标准答案锚点没找到（${where}）：\n${from}`);
  }
  return src.replace(from, to);
}

module.exports = {
  taskId: '44-hard-scale-perf-behavior',

  apply(dir) {
    patch(dir, 'src/analyzer.js', (src) => {
      let out = src;

      // ── 1. 词频统计：O(n²) → O(n) ──
      out = replaceOnce(
        out,
        [
          '  // 词频：朴素计数 —— 每个词都在整个词表里扫一遍',
          '  const frequencies = {};',
          '  for (const token of tokens) {',
          '    const count = tokens.filter((t) => t === token).length;',
          '    frequencies[token] = count;',
          '  }',
        ].join('\n'),
        [
          '  // 词频：一次遍历计数。',
          '  //',
          '  // ⚠️ 原来是 O(n²) 的朴素计数（每个词都在整个词表里扫一遍），',
          '  //    在长文档上这是整个热路径 85% 的耗时来源。',
          '  //',
          '  // ⚠️ 用 Map 而不是对象来累加，是为了保住【插入顺序】：',
          '  //    Map 保插入顺序，转成对象时按同一个顺序插入，',
          '  //    Object.keys(frequencies) 的顺序就跟原来一模一样 ——',
          '  //    同频词的排序依赖这个顺序，不能变。',
          '  const counts = new Map();',
          '  for (const token of tokens) {',
          '    counts.set(token, (counts.get(token) || 0) + 1);',
          '  }',
          '  const frequencies = {};',
          '  for (const entry of counts) {',
          '    frequencies[entry[0]] = entry[1];',
          '  }',
        ].join('\n'),
        'src/analyzer.js / 词频统计',
      );

      // ── 2. 去掉末尾的深拷贝 ──
      out = replaceOnce(
        out,
        [
          '  // 深拷贝快照：调用方拿到的必须跟内部状态无关',
          '  return JSON.parse(JSON.stringify(stats));',
        ].join('\n'),
        [
          '  // ⚠️ 不用再深拷贝一次：',
          '  //    stats 里的每个字段都是本次调用新建的，没有跟任何共享状态挂钩，',
          '  //    那次 JSON 往返纯属浪费（还把整个输出又序列化了一遍）。',
          '  return stats;',
        ].join('\n'),
        'src/analyzer.js / 深拷贝',
      );

      return out;
    });
  },
};
