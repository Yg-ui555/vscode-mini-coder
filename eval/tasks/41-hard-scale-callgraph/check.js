/**
 * 验收脚本 —— 41-hard-scale-callgraph
 *
 * ⭐ 本题的核心是【别漏掉运行期才被发现的那一批 job】：
 *
 *   内置 job 在自己的文件里调 register() 自注册；
 *   扩展插件（src/extensions/*.plugin.js）根本不调 register()，
 *   是加载器在运行期扫目录才发现的。
 *
 *   所以"grep register("只能看到内置 job ——
 *   漏掉插件的那道 case 就是本题的判分点。
 *
 * 判定方式：全部二值断言，不依赖 LLM 打分。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

/** 加载沙箱里的模块（每次清缓存，保证读到的是最新代码） */
function loadMod(dir, rel) {
  const p = path.join(dir, rel);
  assert.ok(fs.existsSync(p), `文件不存在：${rel}`);
  delete require.cache[require.resolve(p)];
  return require(p);
}

/** 启动执行器，返回注册表 */
function boot(dir) {
  return loadMod(dir, 'index.js').boot();
}

/** 全部已注册的 kind（这是规格的一部分，不是"当前有什么"） */
const KINDS = [
  'billing.dunning',
  'billing.invoice',
  'billing.payout',
  'billing.refund',
  'billing.subscription',
  'billing.tax',
  'inventory.audit',
  'inventory.reorder',
  'inventory.reserve',
  'inventory.shrink',
  'inventory.stock',
  'inventory.transfer',
  'notify.digest',
  'notify.email',
  'notify.preference',
  'notify.push',
  'notify.sms',
  'notify.webhook',
  'shipping.customs',
  'shipping.dispatch',
  'shipping.label',
  'shipping.rate',
  'shipping.returnOrder',
  'shipping.track',
  'ext.audit',
  'ext.backup',
  'ext.metrics',
  'ext.quota',
  'ext.reindex',
  'ext.throttle',
];

/** 统一测试输入 */
const INPUT = { amount: 12345, label: 'demo', count: 3 };

/**
 * 某个 kind 成功时应该返回的完整结果
 *
 * ⚠️ 数据内容跟 kind 名字绑定（group / name 就是 kind 的两段），
 *    所以断言里不需要为 30 个 kind 逐个手写期望值 ——
 *    但也正因如此，改了业务数据（哪怕只改一个字段）一定会被抓出来。
 */
function expectedOutcome(kind) {
  const [group, name] = kind.split('.');
  return {
    ok: true,
    data: { group, name, amount: 12345, label: 'demo', total: 24690 },
  };
}

/** kind → 它的实现文件在哪 */
function modulePathOf(kind) {
  const [group, name] = kind.split('.');
  if (group === 'ext') return `src/extensions/${name}.plugin.js`;
  return `src/handlers/${group}/${name}.js`;
}

/**
 * 检查一组 kind：dispatch 的返回值必须逐字等于期望值
 */
function assertGroup(dir, kinds, label) {
  const registry = boot(dir);
  const bad = [];
  for (const kind of kinds) {
    let actual;
    try {
      actual = registry.dispatch(kind, INPUT);
    } catch (e) {
      bad.push(`${kind}：抛异常了（${e.message}）`);
      continue;
    }
    try {
      assert.deepStrictEqual(actual, expectedOutcome(kind));
    } catch {
      bad.push(`${kind}：实际是 ${JSON.stringify(actual)}`);
    }
  }
  assert.strictEqual(
    bad.length,
    0,
    `${label}里有 ${bad.length} 个 job 不遵守结果契约：\n  - ${bad.join('\n  - ')}\n` +
      `  期望形状：{ ok: true, data: { group, name, amount, label, total } }`,
  );
}

module.exports = {
  taskId: '41-hard-scale-callgraph',

  cases: [
    // ═══ 本题目标（baseline 挂 → after 过）═══
    {
      name: '⭐⭐ billing 组的 job 都返回契约形状',
      fn: ({ dir }) => {
        assertGroup(
          dir,
          KINDS.filter((k) => k.startsWith('billing.')),
          'billing 组',
        );
      },
    },
    {
      name: '⭐⭐ inventory 组的 job 都返回契约形状',
      fn: ({ dir }) => {
        assertGroup(
          dir,
          KINDS.filter((k) => k.startsWith('inventory.')),
          'inventory 组',
        );
      },
    },
    {
      name: '⭐⭐ shipping 组的 job 都返回契约形状',
      fn: ({ dir }) => {
        assertGroup(
          dir,
          KINDS.filter((k) => k.startsWith('shipping.')),
          'shipping 组',
        );
      },
    },
    {
      name: '⭐⭐ notify 组的 job 都返回契约形状',
      fn: ({ dir }) => {
        assertGroup(dir, KINDS.filter((k) => k.startsWith('notify.')), 'notify 组');
      },
    },
    {
      name: '⭐⭐⭐ 扩展插件（运行期才被加载的那批 job）也必须遵守契约',
      fn: ({ dir }) => {
        // ⚠️ 这批 job 在源码里没有 register()，grep 是搜不到的。
        //    只改了"grep 得到的那一批"就收工的话，这条会挂。
        assertGroup(dir, KINDS.filter((k) => k.startsWith('ext.')), '扩展插件');
      },
    },
    {
      name: '⭐⭐⭐ 每个 job 模块自己的 run() 也返回契约形状（不许在 dispatch 里统一包一层）',
      fn: ({ dir }) => {
        const bad = [];
        for (const kind of KINDS) {
          const rel = modulePathOf(kind);
          let mod;
          try {
            mod = loadMod(dir, rel);
          } catch (e) {
            bad.push(`${rel}：加载失败（${e.message}）`);
            continue;
          }
          if (!mod || typeof mod.run !== 'function') {
            bad.push(`${rel}：没有导出 run 函数`);
            continue;
          }
          let actual;
          try {
            actual = mod.run(INPUT);
          } catch (e) {
            bad.push(`${rel}：run 抛异常了（${e.message}）`);
            continue;
          }
          try {
            assert.deepStrictEqual(actual, expectedOutcome(kind));
          } catch {
            bad.push(`${rel}：实际是 ${JSON.stringify(actual)}`);
          }
        }
        assert.strictEqual(
          bad.length,
          0,
          `${bad.length} 个 job 模块自己的 run() 不遵守契约：\n  - ${bad.join('\n  - ')}\n` +
            `  ⚠️ 契约要由每个 job 自己遵守 —— 在 dispatch() 里统一包一层不算数`,
        );
      },
    },

    // ═══ 回归守卫（baseline 必须通过）═══
    {
      name: '回归守卫：未知 kind 仍然抛 Unknown job kind',
      fn: ({ dir }) => {
        const registry = boot(dir);
        assert.throws(
          () => registry.dispatch('no.such.kind', INPUT),
          /Unknown job kind/,
          'dispatch 遇到未知 kind 时必须抛 "Unknown job kind: xxx"，不能改成返回 undefined',
        );
      },
    },
    {
      name: '回归守卫：已合规的 job 输出逐字不变',
      fn: ({ dir }) => {
        const registry = boot(dir);
        // 这四个在初始代码上就是合规的 —— 它们的数据不能被"顺手统一"掉
        const checked = ['billing.invoice', 'inventory.stock', 'shipping.label', 'notify.email'];
        for (const kind of checked) {
          assert.deepStrictEqual(
            registry.dispatch(kind, INPUT),
            expectedOutcome(kind),
            `${kind} 的输出被改动了 —— 本题只要求包一层契约，业务数据不许变`,
          );
        }
      },
    },
    {
      name: '回归守卫：contract 的 ok / fail 行为没被改',
      fn: ({ dir }) => {
        const { ok, fail } = loadMod(dir, 'src/core/contract.js');
        assert.deepStrictEqual(ok(1), { ok: true, data: 1 }, 'ok(data) 必须返回 { ok: true, data }');
        assert.deepStrictEqual(
          ok(undefined),
          { ok: true, data: undefined },
          'ok(undefined) 也必须返回 { ok: true, data: undefined }',
        );
        assert.deepStrictEqual(
          fail('boom'),
          { ok: false, error: 'boom' },
          'fail(error) 必须返回 { ok: false, error }',
        );
        assert.deepStrictEqual(fail(404), { ok: false, error: '404' }, 'fail 要把错误转成字符串');
      },
    },
    {
      name: '回归守卫：注册的 kind 集合没变（30 个，一个不多一个不少）',
      fn: ({ dir }) => {
        const registry = boot(dir);
        const actual = registry.kinds();
        assert.deepStrictEqual(
          actual,
          KINDS.slice().sort(),
          `kind 集合变了：\n  实际 = ${JSON.stringify(actual)}\n  期望 = ${JSON.stringify(KINDS.slice().sort())}`,
        );
      },
    },
    {
      name: '回归守卫：注册表的对外接口没变',
      fn: ({ dir }) => {
        // ⚠️ 这里必须用 boot() 拿到的注册表：
        //    单独 require registry.js 会清掉模块缓存、造出一个新的空注册表。
        const registry = boot(dir);
        for (const fn of ['register', 'get', 'kinds', 'dispatch']) {
          assert.strictEqual(typeof registry[fn], 'function', `registry.${fn} 没了或不是函数`);
        }
        assert.strictEqual(
          typeof registry.get('billing.invoice'),
          'function',
          'get() 应该能取到已注册的 job',
        );
        assert.strictEqual(registry.get('no.such.kind'), undefined, 'get() 找不到时返回 undefined');
      },
    },
  ],
};
