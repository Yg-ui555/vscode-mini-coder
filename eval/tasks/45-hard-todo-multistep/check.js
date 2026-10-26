/**
 * 验收脚本 —— 45-hard-todo-multistep
 *
 * 这道题测两件事：
 *   A. 代码改对了没有（修 bug + 合并重复逻辑）
 *   B. 多步任务里有没有真的维护待办清单（工具纪律 + 清单走没走完）
 *
 * 判定要点：
 *   1. itemTotal 的正数行为没被改坏                （回归守卫，baseline 过）
 *   2. formatPrice 对 0 和负数都正确                （baseline 挂 → after 过）
 *   3. 三份拷贝合并成 util.js 里的一个公共函数      （baseline 挂 → after 过）
 *   4. transcript 里出现过 todo_write              （baseline 挂 → after 过）
 *   5. 最后一次 todo_write 时清单已全部完成/已清空  （baseline 挂 → after 过）
 *   6. docs/NOTES.md 一个字节都没被碰过             （回归守卫，baseline 过）
 *
 * ⚠️ case 4 / case 5 依赖 transcript。
 *    baseline 阶段的 transcript 是空数组，所以这两条必然在 baseline 挂 ——
 *    这正是 runner 要的"baseline 挂 → after 过"信号。
 *    但 verifySolvable 喂的是一份【固定的假 transcript】
 *    （list_dir / glob / grep 三条，见 src/eval/verifySolvable.ts），
 *    那份数据里没有 todo_write，所以这两条在 eval:solvable 下【必然失败】——
 *    这是校验器的覆盖盲区（框架限制），不是题目缺陷，也不是 oracle 写错了。
 *    详见 eval/oracles/45-hard-todo-multistep.solution.js 的文件头注释。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

/** 读初始代码快照（用来做"哪些文件被动过"的比对） */
function initialFile(ctx, rel) {
  const dir = ctx.task && ctx.task.initialDir;
  if (!dir) return null;
  try {
    return fs.readFileSync(path.join(dir, rel), 'utf-8');
  } catch {
    return null;
  }
}

/** 读沙箱里的文件 */
function sandboxFile(ctx, rel) {
  try {
    return fs.readFileSync(path.join(ctx.dir, rel), 'utf-8');
  } catch {
    return null;
  }
}

/** 公共函数约定的探针：分 -> 元字符串 */
const CONTRACT = [
  [1250, '12.50'],
  [0, '0.00'],
  [-250, '-2.50'],
];

module.exports = {
  taskId: '45-hard-todo-multistep',

  cases: [
    // ═══ 回归守卫（baseline 必须过）═══
    {
      name: '【回归】itemTotal 原来的行为没被改坏',
      fn: ({ dir }) => {
        const calc = require(path.join(dir, 'src/calc.js'));
        assert.strictEqual(typeof calc.itemTotal, 'function', 'itemTotal 必须继续导出');
        assert.strictEqual(calc.itemTotal(1250, 2), '25.00', 'itemTotal(1250, 2) 应为 "25.00"');
        assert.strictEqual(calc.itemTotal(999, 1), '9.99', 'itemTotal(999, 1) 应为 "9.99"');
        assert.strictEqual(calc.itemTotal(250, 3), '7.50', 'itemTotal(250, 3) 应为 "7.50"');
      },
    },

    // ═══ 本题目标（baseline 挂 → after 过）═══
    {
      name: '【修复】formatPrice 对 0 和负数都算对了',
      fn: ({ dir }) => {
        const mod = require(path.join(dir, 'src/format.js'));
        assert.strictEqual(typeof mod.formatPrice, 'function', 'formatPrice 必须继续导出');

        // 正数不能被改坏
        assert.strictEqual(mod.formatPrice(1250), '¥12.50', 'formatPrice(1250) 应为 "¥12.50"');
        assert.strictEqual(mod.formatPrice(100), '¥1.00', 'formatPrice(100) 应为 "¥1.00"');

        // 0 的这一档
        assert.strictEqual(
          mod.formatPrice(0),
          '¥0.00',
          'formatPrice(0) 应为 "¥0.00" —— 初始实现返回的是 "¥0"'
        );

        // 负数要保留负号（两种写法都接受：¥-2.50 / -¥2.50）
        const neg1 = mod.formatPrice(-250);
        assert.ok(
          neg1 === '¥-2.50' || neg1 === '-¥2.50',
          `formatPrice(-250) 应为 "¥-2.50"（或 "-¥2.50"），实际是 ${JSON.stringify(neg1)} —— ` +
            '负号被 Math.abs 吃掉了'
        );
        const neg2 = mod.formatPrice(-2500);
        assert.ok(
          neg2 === '¥-25.00' || neg2 === '-¥25.00',
          `formatPrice(-2500) 应为 "¥-25.00"（或 "-¥25.00"），实际是 ${JSON.stringify(neg2)}`
        );
      },
    },

    {
      name: '【抽取】三份「分转元」拷贝合并成 util.js 里的一个公共函数',
      fn: (ctx) => {
        const dir = ctx.dir;
        const calcSrc = sandboxFile(ctx, 'src/calc.js');
        const formatSrc = sandboxFile(ctx, 'src/format.js');
        const utilSrc = sandboxFile(ctx, 'src/util.js');
        assert.ok(calcSrc !== null, 'src/calc.js 不见了');
        assert.ok(formatSrc !== null, 'src/format.js 不见了');
        assert.ok(utilSrc !== null, 'src/util.js 不见了');

        // ① 两个调用方都要依赖同一个公共模块
        assert.match(
          calcSrc,
          /require\(\s*['"]\.\/util(\.js)?['"]\s*\)/,
          'src/calc.js 应该 require(\'./util\')，改用公共函数'
        );
        assert.match(
          formatSrc,
          /require\(\s*['"]\.\/util(\.js)?['"]\s*\)/,
          'src/format.js 应该 require(\'./util\')，改用公共函数'
        );

        // ② 两个调用方里不能再留着自己的拷贝
        assert.ok(
          !/%\s*100/.test(calcSrc),
          'src/calc.js 里还留着一份自己的「分转元」实现（没合并到 util.js）'
        );
        assert.ok(
          !/%\s*100/.test(formatSrc),
          'src/format.js 里还留着一份自己的「分转元」实现（没合并到 util.js）'
        );

        // ③ util.js 里只剩一份实现
        const copies = (utilSrc.match(/%\s*100/g) || []).length;
        assert.ok(
          copies <= 1,
          `src/util.js 里还有 ${copies} 份「分转元」的拷贝，应该合并成一份`
        );

        // ④ 公共函数本身要满足约定
        const util = require(path.join(dir, 'src/util.js'));
        const fns = Object.entries(util).filter(([, v]) => typeof v === 'function');
        assert.ok(fns.length > 0, 'src/util.js 一个函数都没导出');
        const good = fns.find(([, fn]) => {
          try {
            return CONTRACT.every(([input, want]) => fn(input) === want);
          } catch {
            return false;
          }
        });
        assert.ok(
          good,
          'src/util.js 导出的函数里没有一个满足公共函数的约定：' +
            CONTRACT.map(([i, w]) => `${i} -> "${w}"`).join('，')
        );

        // ⑤ calc.js 也真的走的是这个公共函数（负数、0 都对）
        const calc = require(path.join(dir, 'src/calc.js'));
        assert.strictEqual(
          calc.itemTotal(-250, 1),
          '-2.50',
          'itemTotal(-250, 1) 应为 "-2.50" —— 说明 calc.js 还在用自己那份旧拷贝'
        );
        assert.strictEqual(
          calc.itemTotal(0, 1),
          '0.00',
          'itemTotal(0, 1) 应为 "0.00" —— 说明 calc.js 还在用自己那份旧拷贝'
        );
      },
    },

    {
      name: '【工具纪律】多步任务里确实列过步骤清单（todo_write）',
      fn: ({ transcript }) => {
        const calls = transcript.filter((t) => t.tool === 'todo_write');
        assert.ok(
          calls.length > 0,
          '本题是多步任务，要求先列一个步骤清单再动手，但一次都没调用过 todo_write'
        );
        const okCalls = calls.filter((t) => !t.isError);
        assert.ok(
          okCalls.length > 0,
          `调用了 ${calls.length} 次 todo_write，但全是报错，说明参数写错了：\n` +
            calls.map((t) => '  - ' + t.preview).join('\n')
        );
      },
    },

    {
      name: '【待办走完】最后一次 todo_write 时清单已全部完成（或已清空）',
      fn: ({ transcript }) => {
        const calls = transcript.filter((t) => t.tool === 'todo_write');
        assert.ok(calls.length > 0, '一次都没调用过 todo_write，谈不上"走完"');

        // 取最后一次调用；如果最后一次报错了（没生效），往前找最后一次成功的
        let last = calls[calls.length - 1];
        if (last.isError) {
          const okCalls = calls.filter((t) => !t.isError);
          last = okCalls[okCalls.length - 1];
        }
        assert.ok(last, '没有一次成功的 todo_write 调用');

        const todos = last.args && last.args.todos;
        assert.ok(
          Array.isArray(todos),
          `最后一次 todo_write 的参数里没有 todos 数组：${JSON.stringify(last.args)}`
        );

        // 空数组 = 已清空 = 全部做完（任务要求"做完后收掉清单"，两种都算过）
        if (todos.length === 0) return;

        const unfinished = todos.filter((t) => !t || t.status !== 'completed');
        assert.strictEqual(
          unfinished.length,
          0,
          `最后一次 todo_write 时还有 ${unfinished.length} 项没标成 completed：` +
            unfinished.map((t) => (t && t.content) || '(无名)').join(' / ')
        );
      },
    },

    // ═══ 回归守卫 ═══
    {
      name: '【别乱改】docs/NOTES.md 一个字节都没被碰过',
      fn: (ctx) => {
        const before = initialFile(ctx, 'docs/NOTES.md');
        assert.ok(before !== null, '拿不到初始 docs/NOTES.md 的快照');
        const now = sandboxFile(ctx, 'docs/NOTES.md');
        assert.ok(now !== null, 'docs/NOTES.md 被删了 —— 本题只要求改 src/ 下的代码');
        assert.strictEqual(now, before, 'docs/NOTES.md 被改了 —— 本题只要求改 src/ 下的代码');

        // src/ 下的初始文件也不许被删
        for (const rel of ['src/calc.js', 'src/format.js', 'src/util.js']) {
          assert.ok(
            fs.existsSync(path.join(ctx.dir, rel)),
            `${rel} 被删了 —— 合并重复逻辑不需要删文件`
          );
        }
      },
    },
  ],
};
