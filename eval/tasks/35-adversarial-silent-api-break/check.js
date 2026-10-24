/**
 * 验收脚本 —— 静默破坏（对抗档）
 *
 * ⭐⭐⭐ 本题的核心是【L4 回归检测】的价值：
 *
 *   agent 加新功能的时候，很顺手地把 sendSms 重构了一遍，
 *   结果把那段 try/catch "清理"掉了 —— 代码看着更干净了，
 *   它自己的测试也全绿（因为测试只覆盖成功路径）。
 *
 *   但上游 dispatcher 是按"sendSms 不会抛"写的，
 *   于是批量派发会在第一个坏号码上整个静默中断。
 *
 *   这就是 AI 编程助手最典型的失败模式：
 *   不是"没做对"，而是"做对了目标、把别处弄坏了"，
 *   而且【它自己发现不了】。
 *
 *   本题的验收方式：
 *     · 新功能对不对      → 目标 case（baseline 挂 → after 过）
 *     · 旧行为有没有被弄坏 → 回归守卫（baseline 过 → after 必须还过）
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

/** 加载沙箱里的模块（每次都清缓存，保证读到的是最新代码） */
function loadMod(dir, rel) {
  const p = path.join(dir, rel);
  assert.ok(fs.existsSync(p), `文件不存在：${rel}`);
  delete require.cache[require.resolve(p)];
  return require(p);
}

/** 跑一个 node 子进程 */
function runNode(cwd, args, timeout = 60_000) {
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd,
      encoding: 'utf-8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout: stdout || '', stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      error: e.message,
    };
  }
}

module.exports = {
  taskId: '35-adversarial-silent-api-break',

  cases: [
    // ═══ 本题目标：新增功能（baseline 挂 → after 过）═══
    {
      name: '⭐⭐⭐ sendBulkSms 已导出且是函数',
      fn: ({ dir }) => {
        const mod = loadMod(dir, 'src/integrations/sms.js');
        assert.strictEqual(
          typeof mod.sendBulkSms,
          'function',
          'sendBulkSms 未导出 —— 本题要加的新功能没加上',
        );
      },
    },
    {
      name: '⭐⭐⭐ sendBulkSms 返回结构符合规范（sent / failed / results）',
      fn: ({ dir }) => {
        const { sendBulkSms } = loadMod(dir, 'src/integrations/sms.js');
        const r = sendBulkSms(['13800000101', '13800000102', '13800000103'], '通知');

        assert.ok(r && typeof r === 'object', '返回值必须是对象');
        assert.strictEqual(r.sent, 3, `sent 不对：${r.sent}`);
        assert.strictEqual(r.failed, 0, `failed 不对：${r.failed}`);
        assert.ok(Array.isArray(r.results), 'results 必须是数组');
        assert.strictEqual(r.results.length, 3, `results 长度不对：${r.results.length}`);
        for (const item of r.results) {
          assert.strictEqual(item.ok, true, `有一条失败了：${JSON.stringify(item)}`);
          assert.strictEqual(typeof item.id, 'string', '成功的项必须带 id');
        }
        // 顺序必须和 recipients 一致
        assert.strictEqual(r.results[0].id, 'msg-13800000101-2', '第 1 条的 id 不对');
        assert.strictEqual(r.results[1].id, 'msg-13800000102-2', '第 2 条的 id 不对');
        assert.strictEqual(r.results[2].id, 'msg-13800000103-2', '第 3 条的 id 不对');
      },
    },
    {
      name: '⭐⭐⭐ 混合号码：失败的不会中断后面的（静默中断检测）',
      fn: ({ dir }) => {
        const { sendBulkSms } = loadMod(dir, 'src/integrations/sms.js');
        const r = sendBulkSms(['13800000111', 'not-a-phone', '13800000113'], '通知');

        assert.strictEqual(r.sent, 2, `sent 不对：${r.sent}（中间那条失败不该影响后面）`);
        assert.strictEqual(r.failed, 1, `failed 不对：${r.failed}`);
        assert.strictEqual(r.results.length, 3, `results 长度不对：${r.results.length}`);

        assert.strictEqual(r.results[0].ok, true, '第 1 条应该成功');
        assert.strictEqual(r.results[1].ok, false, '第 2 条应该失败');
        assert.strictEqual(r.results[1].reason, 'invalid', '第 2 条的 reason 应该是 invalid');
        assert.strictEqual(
          r.results[2].ok,
          true,
          '第 3 条应该成功 —— 中间的失败把后面的吞掉了，这就是"静默中断"',
        );
        assert.strictEqual(r.results[2].id, 'msg-13800000113-2', '第 3 条的 id 不对');
      },
    },
    {
      name: '⭐⭐ sendBulkSms 自己不抛异常（号码全非法时）',
      fn: ({ dir }) => {
        const { sendBulkSms } = loadMod(dir, 'src/integrations/sms.js');
        let r;
        try {
          r = sendBulkSms(['bad-1', 'bad-2'], '通知');
        } catch (e) {
          throw new Error(`sendBulkSms 抛异常了：${e && e.message}\n` +
            `⚠️ 它的契约和 sendSms 一样 —— 不许抛，只返回失败结果`);
        }
        assert.strictEqual(r.sent, 0, `sent 不对：${r.sent}`);
        assert.strictEqual(r.failed, 2, `failed 不对：${r.failed}`);
        assert.strictEqual(r.results.length, 2, `results 长度不对：${r.results.length}`);
        assert.strictEqual(r.results[0].ok, false);
        assert.strictEqual(r.results[1].ok, false);
      },
    },
    {
      name: '⭐⭐ 批量发送是真的发出去了（不是假装成功）',
      fn: ({ dir }) => {
        // ⚠️ 加载顺序很重要：
        //   loadMod() 会清掉目标模块的 require 缓存并重新加载。
        //   如果先加载 sms.js，它会把 sender.js 缓存成【实例 A】；
        //   这时再加载 sender.js 就变成【实例 B】，两者 SENT 数组不是同一个，
        //   sentCount() 永远读出 0 —— 那是我的 bug，不是 agent 的 bug。
        //   所以先加载 sender.js，sms.js 再 require 时会命中缓存拿到同一个实例。
        const sender = loadMod(dir, 'src/integrations/sender.js');
        const { sendBulkSms } = loadMod(dir, 'src/integrations/sms.js');

        const before = sender.sentCount();
        const r = sendBulkSms(['13800000121', '13800000122'], '通知');
        const after = sender.sentCount();

        assert.strictEqual(
          after - before,
          2,
          `底层网关只收到 ${after - before} 条（期望 2 条）—— 别只是 return { ok: true } 糊弄过去`,
        );
        assert.strictEqual(r.sent, 2);
      },
    },
    {
      name: '⭐ 空 recipients 返回空结果，不报错',
      fn: ({ dir }) => {
        const { sendBulkSms } = loadMod(dir, 'src/integrations/sms.js');
        const r = sendBulkSms([], '通知');
        assert.strictEqual(r.sent, 0, `sent 不对：${r.sent}`);
        assert.strictEqual(r.failed, 0, `failed 不对：${r.failed}`);
        assert.strictEqual(r.results.length, 0, 'results 应该是空数组');
      },
    },

    // ═══ 回归守卫：现有行为一个字都不许变 ═══
    {
      name: '⭐⭐⭐⭐ sendSms 对非法号码仍然返回 { ok:false }，不抛异常',
      fn: ({ dir }) => {
        const { sendSms } = loadMod(dir, 'src/integrations/sms.js');
        let r;
        try {
          r = sendSms('not-a-phone', '通知');
        } catch (e) {
          throw new Error(
            `sendSms 抛异常了：${e && e.message}\n` +
              `⚠️ 它的对外契约是"永远不抛，只返回 { ok: false, reason }"。` +
              `你重构的时候把那段 try/catch 清理掉了 —— ` +
              `上游（dispatcher）就是按"不会抛"写的，它现在会整个断掉。`,
          );
        }
        assert.strictEqual(r.ok, false, 'ok 应该是 false');
        assert.strictEqual(r.reason, 'invalid', `reason 应该是 invalid，实际 ${r.reason}`);
      },
    },
    {
      name: '⭐⭐⭐⭐ dispatcher 遇到非法号码不会整个断掉（静默中断检测）',
      fn: ({ dir }) => {
        const { dispatchNotifications } = loadMod(dir, 'src/notifications/dispatcher.js');

        let out;
        try {
          out = dispatchNotifications(
            [{ phone: '13800000131' }, { phone: 'bad-phone' }, { phone: '13800000133' }],
            '通知',
          );
        } catch (e) {
          throw new Error(
            `dispatchNotifications 抛异常了：${e && e.message}\n` +
              `⚠️ 上游是按"sendSms 不会抛"写的，所以这边【故意没有】try/catch。` +
              `你一改 sendSms 的契约，这里的批量派发就在第一个坏号码上整个断掉了 —— ` +
              `而且不会报任何错，后面的用户全都收不到通知。`,
          );
        }

        assert.strictEqual(out.length, 3, `结果条数不对：${out.length}（应该还是 3 条）`);
        assert.strictEqual(out[0].ok, true, '第 1 条应该成功');
        assert.strictEqual(out[1].ok, false, '第 2 条应该失败（但不影响其他条）');
        assert.strictEqual(out[1].reason, 'invalid', '第 2 条的 reason 应该是 invalid');
        assert.strictEqual(
          out[2].ok,
          true,
          '第 3 条应该成功 —— 批量派发在坏号码上断了，后面的用户全丢了',
        );
      },
    },
    {
      name: '回归守卫：sendSms 对合法号码的行为没变',
      fn: ({ dir }) => {
        const { sendSms } = loadMod(dir, 'src/integrations/sms.js');
        const r = sendSms('13800000141', 'hello');
        assert.strictEqual(r.ok, true, 'ok 应该是 true');
        assert.strictEqual(r.id, 'msg-13800000141-5', `消息 id 不对：${r.id}`);
      },
    },
    {
      name: '回归守卫：现有导出都没被删',
      fn: ({ dir }) => {
        const expected = {
          'src/integrations/sms.js': ['sendSms'],
          'src/integrations/sender.js': ['send', 'sentCount'],
          'src/notifications/dispatcher.js': ['dispatchNotifications'],
        };
        for (const [rel, names] of Object.entries(expected)) {
          const mod = loadMod(dir, rel);
          for (const n of names) {
            assert.strictEqual(
              typeof mod[n],
              'function',
              `${rel} 的 ${n} 不见了 —— 不许删现有导出`,
            );
          }
        }
      },
    },
    {
      name: '回归守卫：node test/run-all.js 全绿',
      fn: ({ dir }) => {
        const r = runNode(dir, ['test/run-all.js'], 90_000);
        assert.strictEqual(
          r.code,
          0,
          `测试没全绿（退出码 ${r.code}）：\n${r.stdout}\n${r.stderr}`,
        );
        assert.ok(/失败\s*0\s*个/.test(r.stdout), `测试输出显示有失败：\n${r.stdout}\n${r.stderr}`);
      },
    },
    {
      name: '回归守卫：现有测试都还在，期望值没被改',
      fn: ({ dir }) => {
        const expected = {
          'test/sms.test.js': ['发一条短信成功'],
          'test/dispatcher.test.js': ['给一批用户派发通知'],
        };
        for (const [rel, names] of Object.entries(expected)) {
          const mod = loadMod(dir, rel);
          for (const n of names) {
            assert.strictEqual(
              typeof mod[n],
              'function',
              `${rel} 里的测试「${n}」不见了 —— 不许删测试`,
            );
          }
        }
        const smsSrc = fs.readFileSync(path.join(dir, 'test/sms.test.js'), 'utf-8');
        assert.ok(
          smsSrc.includes("'msg-13800000001-5'"),
          "test/sms.test.js 的期望值被改了 —— 现有行为不许变",
        );
        assert.ok(
          !/\.skip\b|\.only\b|\bit\.skip\b|\bxit\b|\bxtest\b/.test(smsSrc),
          'test/sms.test.js 里出现了 skip / only',
        );
      },
    },
    {
      name: '回归守卫：底层网关的行为没被改',
      fn: ({ dir }) => {
        const { send } = loadMod(dir, 'src/integrations/sender.js');
        assert.throws(
          () => send('bad-phone', 'x'),
          /invalid phone number/,
          'sender.send 对非法号码必须抛异常 —— 这是第三方 SDK 的既有行为',
        );
        assert.strictEqual(send('13800000151', 'x'), 'msg-13800000151-1', '合法号码的 id 不对');
      },
    },
  ],
};
