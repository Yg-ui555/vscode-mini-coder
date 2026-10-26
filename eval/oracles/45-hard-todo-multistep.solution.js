/**
 * 45-hard-todo-multistep 的标准答案
 *
 * ⭐ 这份文件的作用是【证明这道题可解】：
 *   verifySolvable.ts 会把 initial/ 复制到沙箱、执行本文件、再跑全部 case，
 *   要求一个 case 都不挂。
 *
 * ⚠️⚠️ 有两条 case 判的是【工具调用轨迹】，所以本文件里有一份"标准轨迹"
 *
 *   check.js 里的
 *     · 「【工具纪律】多步任务里确实列过步骤清单（todo_write）」
 *     · 「【待办走完】最后一次 todo_write 时清单已全部完成（或已清空）」
 *   判的是 ctx.transcript（agent 的工具调用轨迹）。
 *
 *   下面 transcript 字段就是这道题的【标准答案轨迹】：
 *   列清单 → 干活 → 逐项更新状态 → 全部完成 → 清空。
 *   verifySolvable 会优先用它（2026-10-26 加的通道）。
 *
 *   ⚠️ 加这个通道之前，这两条在 eval:solvable 下【必然失败】——
 *     那时候校验器只喂一份写死的假轨迹（list_dir / glob / grep），
 *     里面没有 todo_write。
 *     挂的原因不是题废、也不是 oracle 写错，是【校验器缺一个通道】。
 *
 *   本文件【不会】去碰 docs/NOTES.md，也不会新增/删除任何文件。
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  taskId: '45-hard-todo-multistep',

  /**
   * 这道题的标准回复（人写的）。
   *
   * ⚠️ 本题没有任何一条 case 判 finalAnswer —— 判分点在代码状态 + 工具轨迹上。
   *    这个字段保留在这里，是为了让"人写的标准答案"完整地记下来。
   */
  finalAnswer: [
    '两件事都做完了：',
    '',
    '1. 修好了 formatPrice 的 bug。根因是「分转元」的实现里用了 Math.abs，',
    '   负号被吃掉了；同时 abs === 0 的分支直接返回 "0"，少了两位小数。',
    '   现在 0 -> "¥0.00"，-250 -> "¥-2.50"，正数输出不变。',
    '',
    '2. 合并了重复逻辑。原先「分转元」的实现一共三份拷贝',
    '   （calc.js 一份、format.js 一份、util.js 两份），',
    '   现在合并成 src/util.js 里的一个公共函数 toYuan(cents)，',
    '   calc.js 和 format.js 都改成 require(\'./util\') 去调它。',
    '',
    '过程中列了步骤清单，每做完一步就更新了一次状态，最后清单已清空。',
    'docs/NOTES.md 没有改动。',
  ].join('\n'),

  /**
   * 这道题的标准答案轨迹（工具调用）。
   *
   * ⭐ 判分点在这里：
   *   · 至少有一次成功的 todo_write（case 4）
   *   · 最后一次 todo_write 时清单全部 completed（或已清空）（case 5）
   *
   * 形状刻意做得像真实的一次多步任务：
   *   摸索 → 列清单 → 开工 → 更新状态 → 收尾清空
   */
  transcript: [
    { tool: 'list_dir', args: { path: 'src' }, isError: false, preview: 'calc.js  format.js  util.js' },
    { tool: 'read_file', args: { path: 'src/format.js' }, isError: false, preview: 'function formatPrice(cents) {...}' },
    { tool: 'read_file', args: { path: 'src/calc.js' }, isError: false, preview: 'function itemTotal(cents, qty) {...}' },
    { tool: 'read_file', args: { path: 'src/util.js' }, isError: false, preview: 'function toYuan(cents) {...}' },

    // ① 开工前列清单（三项都是 pending）
    {
      tool: 'todo_write',
      args: {
        todos: [
          { content: '修复 formatPrice 对 0 和负数的处理', status: 'pending' },
          { content: '把三份「分转元」拷贝合并成 util.js 的公共函数', status: 'pending' },
          { content: '验证行为并确认 docs/NOTES.md 未被改动', status: 'pending' },
        ],
      },
      isError: false,
      preview: '已记录 3 条待办',
    },

    // ② 修完 bug，把第一项标成完成、第二项标成进行中
    {
      tool: 'todo_write',
      args: {
        todos: [
          { content: '修复 formatPrice 对 0 和负数的处理', status: 'completed' },
          {
            content: '把三份「分转元」拷贝合并成 util.js 的公共函数',
            status: 'in_progress',
            activeForm: '正在合并「分转元」的重复实现',
          },
          { content: '验证行为并确认 docs/NOTES.md 未被改动', status: 'pending' },
        ],
      },
      isError: false,
      preview: '已记录 3 条待办',
    },

    // ③ 合并完，最后一项也完成了
    {
      tool: 'todo_write',
      args: {
        todos: [
          { content: '修复 formatPrice 对 0 和负数的处理', status: 'completed' },
          { content: '把三份「分转元」拷贝合并成 util.js 的公共函数', status: 'completed' },
          {
            content: '验证行为并确认 docs/NOTES.md 未被改动',
            status: 'completed',
          },
        ],
      },
      isError: false,
      preview: '已记录 3 条待办',
    },

    // ④ 全部做完后清空清单（题目要求：做完后传空数组收掉）
    { tool: 'todo_write', args: { todos: [] }, isError: false, preview: '已清空待办清单' },
  ],

  apply(dir) {
    const write = (rel, lines) => {
      fs.writeFileSync(path.join(dir, rel), lines.join('\n'), 'utf-8');
    };

    // 1. util.js：两份拷贝合并成一份正确的公共实现
    write('src/util.js', [
      '/**',
      ' * 金额工具（公共）',
      ' *',
      ' * 「分转元」的唯一实现 —— calc.js 和 format.js 都调它。',
      ' */',
      '',
      '/**',
      ' * 把「分」转成「元」的字符串。',
      ' *',
      ' * @param {number} cents 金额（分）',
      ' * @returns {string} 形如 "12.50"；负数保留负号，如 "-2.50"',
      ' */',
      'function toYuan(cents) {',
      '  const sign = cents < 0 ? "-" : "";',
      '  const abs = Math.abs(cents);',
      '  const yuan = Math.floor(abs / 100);',
      '  const fen = abs % 100;',
      '  return `${sign}${yuan}.${fen < 10 ? "0" + fen : fen}`;',
      '}',
      '',
      'module.exports = { toYuan };',
      '',
    ]);

    // 2. calc.js：删掉本地拷贝，改调公共函数
    write('src/calc.js', [
      '/**',
      ' * 订单金额计算',
      ' */',
      '',
      "const { toYuan } = require('./util');",
      '',
      '/**',
      ' * 单价 × 数量，返回金额字符串。',
      ' *',
      ' * @param {number} unitCents 单价（分）',
      ' * @param {number} count 数量',
      ' * @returns {string} 形如 "25.00"',
      ' */',
      'function itemTotal(unitCents, count) {',
      '  return toYuan(unitCents * count);',
      '}',
      '',
      'module.exports = { itemTotal };',
      '',
    ]);

    // 3. format.js：删掉本地拷贝，改调公共函数
    write('src/format.js', [
      '/**',
      ' * 金额格式化',
      ' */',
      '',
      "const { toYuan } = require('./util');",
      '',
      '/**',
      ' * 把「分」格式化成 "¥12.50"。',
      ' *',
      ' * @param {number} cents 金额（分）',
      ' * @returns {string} 形如 "¥12.50"',
      ' */',
      'function formatPrice(cents) {',
      '  return `¥${toYuan(cents)}`;',
      '}',
      '',
      'module.exports = { formatPrice };',
      '',
    ]);

    // 4. docs/NOTES.md 一个字节都不碰 —— 它跟本次改动无关
  },
};
