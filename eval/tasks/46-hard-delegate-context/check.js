/**
 * 验收脚本 —— 46-hard-delegate-context
 *
 * 这道题测的是【子智能体的上下文隔离】：
 *   主 agent 不该把 60 个 handler 的内容全读进自己的上下文，
 *   而应该派一个子智能体去查，自己只拿结论。
 *
 * 判定要点：
 *   1. formatUserId 的行为没被改坏                （回归守卫，baseline 过）
 *   2. 结论里点名了绝大多数真正调用它的文件        （baseline 挂 → after 过）
 *   3. 没把"注释里提到"的文件算成调用点            （baseline 过 —— 精度守卫）
 *   4. 拿到了结论，且父 agent 没把 60 个文件读进自己上下文（baseline 挂 → after 过）
 *   5. 调查确实派给了子智能体（delegate）          （baseline 挂 → after 过）
 *   6. 仓库里一个文件都没被改                      （回归守卫，baseline 过）
 *
 * ⚠️ case 4 / case 5 依赖 transcript。
 *    baseline 阶段的 transcript 是空数组，所以这两条必然在 baseline 挂 ——
 *    这正是 runner 要的"baseline 挂 → after 过"信号。
 *    而 verifySolvable 喂的 transcript 是【写死的假数据】
 *    （list_dir / glob / grep 三条，见 src/eval/verifySolvable.ts），
 *    那份数据里既没有 delegate、也没有任何 read_file —— 父 agent 的读取次数是 0，
 *    所以 case 4 反而【会过】，而 case 5 必然失败。
 *    这是校验器的覆盖盲区（框架限制），不是题目缺陷，也不是 oracle 写错了。
 *    详见 eval/oracles/46-hard-delegate-context.solution.js 的文件头注释。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { listFiles } = require('../../shared');

/**
 * 真正调用了 formatUserId 的文件（18 个）
 *
 * ⚠️ 这份名单必须跟 initial/ 里的实际内容对得上。
 *    生成器是 eval/tasks/46-hard-delegate-context/_gen.js，
 *    里面的分配规则是：文件序号 i 的个位 i%10 ∈ {1,2,3} → call。
 */
const CALL_FILES = [
  'user-01.js',
  'order-02.js',
  'payment-03.js',
  'payment-11.js',
  'inventory-12.js',
  'shipping-13.js',
  'shipping-21.js',
  'notification-22.js',
  'report-23.js',
  'report-31.js',
  'auth-32.js',
  'user-33.js',
  'user-41.js',
  'order-42.js',
  'payment-43.js',
  'payment-51.js',
  'inventory-52.js',
  'shipping-53.js',
];

/**
 * 只是【提到】formatUserId 的文件（18 个）—— 不是调用点
 *
 * 分配规则：i%10 ∈ {4,5,6} → mention（注释里提到 / 当字符串用）。
 */
const MENTION_FILES = [
  'inventory-04.js',
  'shipping-05.js',
  'notification-06.js',
  'notification-14.js',
  'report-15.js',
  'auth-16.js',
  'auth-24.js',
  'user-25.js',
  'order-26.js',
  'order-34.js',
  'payment-35.js',
  'inventory-36.js',
  'inventory-44.js',
  'shipping-45.js',
  'notification-46.js',
  'notification-54.js',
  'report-55.js',
  'auth-56.js',
];

/**
 * 关键的几个 —— 一个都不能漏
 *
 * 挑的是后半段（序号 ≥ 42）里"调用点藏在别处"的那几个：
 * order-42（包了一层）、payment-43（命名空间调用）、
 * inventory-52（包了一层）、shipping-53（命名空间调用）。
 */
const KEY_FILES = ['order-42.js', 'payment-43.js', 'inventory-52.js', 'shipping-53.js'];

/** handler 文件总数 */
const HANDLER_COUNT = 60;

/** 父 agent 的读取次数上限（真实文件数的 50%） */
const MAX_PARENT_READS = HANDLER_COUNT / 2;

/** 允许报错的"假阳性"数量：容忍一点手滑，但不许把 36 个提到全报成调用点 */
const MAX_FALSE_POSITIVES = 8;

/**
 * 回复里有没有点名某个文件
 *
 * 模型写文件名的方式五花八门，这里放宽到三种都算数：
 *   · 完整路径或文件名：src/handlers/user-01.js / user-01.js
 *   · 省略扩展名：user-01
 *   · 通配：user-*.js
 */
function mentioned(ans, base) {
  if (ans.includes(base)) return true;
  const noExt = base.replace(/\.js$/, '');
  if (ans.includes(noExt)) return true;
  const prefix = base.replace(/-\d+\.js$/, '');
  if (ans.includes(`${prefix}-*`)) return true;
  return false;
}

module.exports = {
  taskId: '46-hard-delegate-context',

  cases: [
    // ═══ 回归守卫（baseline 必须过）═══
    {
      name: '【回归】formatUserId 的行为没被改坏',
      fn: ({ dir }) => {
        const { formatUserId } = require(path.join(dir, 'src/core/user-id.js'));
        assert.strictEqual(typeof formatUserId, 'function', 'formatUserId 必须继续导出');
        assert.strictEqual(
          formatUserId({ id: 42, name: '张三', email: 'zhang@example.com' }),
          '张三 <zhang@example.com> (#42)',
          'formatUserId 的输出变了'
        );
        assert.strictEqual(
          formatUserId({ id: 7, name: '李四' }),
          '李四 (#7)',
          '没有 email 时的输出变了'
        );
        assert.strictEqual(formatUserId(null), 'unknown', '空用户时的输出变了');
      },
    },

    // ═══ 本题目标（baseline 挂 → after 过）═══
    {
      name: '【找全了】结论里点名了绝大多数真正调用 formatUserId 的文件',
      fn: ({ finalAnswer }) => {
        const ans = String(finalAnswer || '').toLowerCase();
        assert.ok(ans.trim().length > 0, 'finalAnswer 为空：什么都没说就交差');

        const named = CALL_FILES.filter((f) => mentioned(ans, f));
        const need = Math.ceil(CALL_FILES.length * 0.8);
        assert.ok(
          named.length >= need,
          `结论里只点名了 ${named.length}/${CALL_FILES.length} 个真正的调用文件（至少要 ${need} 个）。\n` +
            `已点名：${named.join(', ') || '（一个都没有）'}\n` +
            '没点名：' +
            CALL_FILES.filter((f) => !named.includes(f)).join(', ')
        );

        const missingKey = KEY_FILES.filter((f) => !mentioned(ans, f));
        assert.strictEqual(
          missingKey.length,
          0,
          `这几个关键文件没被点名：${missingKey.join(', ')}\n` +
            '它们的调用点藏在别处（包了一层 / 命名空间调用），别只盯着直接调用。'
        );
      },
    },

    {
      name: '【精度】没把"只在注释/字符串里提到"的文件算成调用点',
      fn: ({ finalAnswer }) => {
        const ans = String(finalAnswer || '').toLowerCase();
        const wrong = MENTION_FILES.filter((f) => mentioned(ans, f));
        assert.ok(
          wrong.length <= MAX_FALSE_POSITIVES,
          `结论里有 ${wrong.length} 个文件其实只是注释/字符串里提到了 formatUserId：\n` +
            `  ${wrong.join(', ')}\n` +
            '这些不是调用点。'
        );
      },
    },

    {
      name: '【⭐上下文隔离】拿到了结论，且没把几十个文件读进自己的上下文',
      fn: ({ transcript, finalAnswer }) => {
        const ans = String(finalAnswer || '');
        assert.ok(ans.trim().length > 0, 'finalAnswer 为空：没拿到结论');

        // 父 agent 自己的读取次数（子 agent 的调用不在父 transcript 里）
        const reads = transcript.filter((t) => t.tool === 'read_file' || t.tool === 'grep');
        assert.ok(
          reads.length < MAX_PARENT_READS,
          `父 agent 自己调了 ${reads.length} 次 read_file/grep（上限 ${MAX_PARENT_READS} 次，` +
            `handler 文件一共 ${HANDLER_COUNT} 个）。\n` +
            '这说明它把整个仓库读进了自己的上下文 —— 这正是子智能体要解决的问题。\n' +
            '调用明细：\n' +
            reads.map((t) => `  - ${t.tool} ${JSON.stringify(t.args).slice(0, 120)}`).join('\n')
        );
      },
    },

    {
      name: '【⭐派了子智能体】调查确实交给了子智能体（delegate）',
      fn: ({ transcript }) => {
        const calls = transcript.filter((t) => t.tool === 'delegate');
        assert.ok(
          calls.length > 0,
          '整个过程里一次 delegate 都没有调用过 —— 这道题的调查应该交给子智能体，' +
            '它的中间过程不进你的上下文，你只该拿到一份结论'
        );
        const okCalls = calls.filter((t) => !t.isError);
        assert.ok(
          okCalls.length > 0,
          `调用了 ${calls.length} 次 delegate，但全是报错：\n` +
            calls.map((t) => '  - ' + t.preview).join('\n')
        );
      },
    },

    // ═══ 回归守卫 ═══
    {
      name: '【只读】仓库里一个文件都没被改（初始代码本身就是正确答案）',
      fn: (ctx) => {
        const initialDir = ctx.task && ctx.task.initialDir;
        assert.ok(initialDir, '拿不到 initial/ 目录');

        const files = listFiles(initialDir, { includeBookkeeping: false });
        assert.ok(files.length > 0, 'initial/ 是空的');

        for (const rel of files) {
          const abs = path.join(ctx.dir, rel);
          assert.ok(fs.existsSync(abs), `${rel} 被删了 —— 这是一道调查题，不该动任何文件`);
          assert.strictEqual(
            fs.readFileSync(abs, 'utf-8'),
            fs.readFileSync(path.join(initialDir, rel), 'utf-8'),
            `${rel} 被改了 —— 这是一道调查题，初始代码本身就是对的`
          );
        }
      },
    },
  ],
};
