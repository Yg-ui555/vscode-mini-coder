/**
 * 46-hard-delegate-context 的标准答案
 *
 * ⭐ 这份文件的作用是【证明这道题可解】：
 *   verifySolvable.ts 会把 initial/ 复制到沙箱、执行本文件、再跑全部 case，
 *   要求一个 case 都不挂。
 *
 * 标准答案的写法：【一个字都不改】。
 *
 * 为什么「什么都不改」才是这道题的正确答案：
 *   这是【纯调查题】—— 初始代码本身就已经包含了所有真正的调用点，
 *   用户只要一份结论。动任何一个字节都是越界。
 *   check.js 里那条「【只读】仓库里一个文件都没被改」就是盯着这件事的。
 *
 * ⚠️⚠️ 有两条 case 判的是【工具调用轨迹】，所以本文件里有一份"标准轨迹"
 *
 *   check.js 里的
 *     · 「【⭐上下文隔离】拿到了结论，且没把几十个文件读进自己的上下文」
 *     · 「【⭐派了子智能体】调查确实交给了子智能体（delegate）」
 *   判的是 ctx.transcript（agent 的工具调用轨迹）。
 *
 *   下面 transcript 字段就是这道题的【标准答案轨迹】：
 *   父 agent 只看了两个文件、跑了一次 grep，然后把调查整个交给了子智能体，
 *   最后只拿回一份结论。
 *
 *   ⚠️ 加这个通道之前，这条「派了子智能体」在 eval:solvable 下【必然失败】——
 *     那时候校验器只喂一份写死的假轨迹（list_dir / glob / grep），
 *     里面没有 delegate。
 *     挂的原因不是题废、也不是 oracle 写错，是【校验器缺一个通道】。
 *
 * finalAnswer 是这道题的标准回复（人写的）——
 *   它覆盖「【找全了】」和「【精度】」两条 case。
 */

const fs = require('fs');
const path = require('path');

/** 真正调用了 formatUserId 的 18 个文件（跟 check.js 里的名单一致） */
const CALL_FILES = [
  'src/handlers/user-01.js',
  'src/handlers/order-02.js',
  'src/handlers/payment-03.js',
  'src/handlers/payment-11.js',
  'src/handlers/inventory-12.js',
  'src/handlers/shipping-13.js',
  'src/handlers/shipping-21.js',
  'src/handlers/notification-22.js',
  'src/handlers/report-23.js',
  'src/handlers/report-31.js',
  'src/handlers/auth-32.js',
  'src/handlers/user-33.js',
  'src/handlers/user-41.js',
  'src/handlers/order-42.js',
  'src/handlers/payment-43.js',
  'src/handlers/payment-51.js',
  'src/handlers/inventory-52.js',
  'src/handlers/shipping-53.js',
];

module.exports = {
  taskId: '46-hard-delegate-context',

  /**
   * 这道题的标准回复（人写的）。
   *
   * 覆盖两条 case：
   *   · 「【找全了】结论里点名了绝大多数真正调用 formatUserId 的文件」
   *   · 「【精度】没把"只在注释/字符串里提到"的文件算成调用点」
   */
  finalAnswer: [
    '调查结论：formatUserId 一共 18 处调用，分布在 18 个文件里，每个文件各 1 处。',
    '',
    '调用点清单：',
    ...CALL_FILES.map((f) => '- ' + f),
    '',
    '补充说明：',
    '- src/core/user-id.js 是 formatUserId 的定义处，不算调用点。',
    '- 另外有 18 个 handler 文件里出现过 formatUserId 这个名字，',
    '  但都只是注释里提到过、或者当成字符串常量用了一下，不是真正的调用，没有计入。',
    '- 其余 handler 跟 formatUserId 完全无关。',
    '- 这次只做了调查，没有改任何文件。',
  ].join('\n'),

  /**
   * 这道题的标准答案轨迹（工具调用）。
   *
   * ⭐ 判分点在这里：
   *   · 父 agent 自己的 read_file + grep 次数 < 30（上限是 handler 文件数的一半）
   *     —— case 4 判的就是这个
   *   · 至少有一次成功的 delegate —— case 5 判的就是这个
   *
   * 形状刻意做得像真实的"上下文隔离"用法：
   *   父 agent 只确认了一下结构、搜了一次，然后把整个调查交给子智能体。
   *   ⚠️ 注意子智能体内部的 read_file/grep 【不在父的轨迹里】——
   *     这正是"上下文隔离"在轨迹上的体现。
   */
  transcript: [
    { tool: 'list_dir', args: { path: 'src' }, isError: false, preview: 'core/  handlers/' },
    {
      tool: 'read_file',
      args: { path: 'src/core/user-id.js' },
      isError: false,
      preview: 'function formatUserId(user) {...}',
    },
    {
      tool: 'grep',
      args: { pattern: 'formatUserId', path: 'src/handlers' },
      isError: false,
      preview: 'src/handlers/user-01.js:1  …（命中很多）',
    },
    {
      tool: 'delegate',
      args: {
        task:
          '调查 src/handlers 下所有调用 formatUserId 的地方，' +
          '区分「真正的调用」和「只在注释/字符串里出现」，' +
          '返回调用点文件清单。',
      },
      isError: false,
      preview: '子智能体完成调查，返回 18 个调用点清单',
    },
  ],

  apply(dir) {
    // 刻意什么都不改 —— 这是一道纯调查题。
    // 这里只确认目标文件还在：沙箱空着会让"没改"和"文件没了"混为一谈。
    const must = [
      'src/core/user-id.js',
      'src/handlers/user-01.js',
      'src/handlers/shipping-53.js',
    ];
    for (const rel of must) {
      if (!fs.existsSync(path.join(dir, rel))) {
        throw new Error('标准答案失效：沙箱里没有 ' + rel);
      }
    }
  },
};
