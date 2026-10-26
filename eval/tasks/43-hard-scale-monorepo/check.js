/**
 * 验收脚本 —— 43-hard-scale-monorepo
 *
 * ⭐ 本题的核心是【调用点一个都不能漏】：
 *
 *   app 包里 15 个模块渲染用户，散落在 5 个目录，
 *   其中有：
 *     · 传字符串的（旧的、静默失效的写法）
 *     · 一个参数都不传的
 *     · 参数经过转发层传出去的（看调用点看不出来）
 *     · 走 core 包总入口而不是深层路径的
 *
 *   漏一处 → 对应目录的 case 直接挂。
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

/** 测试用的用户 */
const USER = { id: 7, name: 'Ada', age: 36, email: 'ada@example.com', features: [] };

/** core 的 formatUser 所在文件 */
const CORE_FORMAT = 'packages/core/src/user/format.js';

/**
 * app 包里所有【渲染用户】的调用点
 *
 * dir 用于分组（分组对应一条 case，漏一处就能定位到哪个目录）。
 */
const APP_CALLERS = [
  { dir: 'features', file: 'packages/app/src/features/profileCard.js', fn: 'render', style: 'compact', expect: '【Ada(36)】' },
  { dir: 'features', file: 'packages/app/src/features/teamList.js', fn: 'render', style: 'compact', expect: 'Ada(36)' },
  { dir: 'features', file: 'packages/app/src/features/billingSummary.js', fn: 'render', style: 'full', expect: 'Ada (36岁)' },
  { dir: 'features', file: 'packages/app/src/features/auditTrail.js', fn: 'render', style: 'full', expect: 'Ada (36岁)' },

  { dir: 'screens', file: 'packages/app/src/screens/userList.js', fn: 'render', style: 'compact', expect: 'Ada(36)' },
  { dir: 'screens', file: 'packages/app/src/screens/userDetail.js', fn: 'render', style: 'full', expect: 'Ada (36岁)' },
  { dir: 'screens', file: 'packages/app/src/screens/preferences.js', fn: 'render', style: 'compact', expect: 'Ada(36)' },
  { dir: 'screens', file: 'packages/app/src/screens/orgTree.js', fn: 'render', style: 'full', expect: 'Ada (36岁)' },

  { dir: 'reports', file: 'packages/app/src/reports/daily.js', fn: 'render', style: 'full', expect: 'Ada (36岁)' },
  { dir: 'reports', file: 'packages/app/src/reports/monthly.js', fn: 'render', style: 'compact', expect: 'Ada(36)' },
  { dir: 'reports', file: 'packages/app/src/reports/export.js', fn: 'render', style: 'full', expect: 'Ada (36岁)' },

  { dir: 'workers', file: 'packages/app/src/workers/notify.js', fn: 'render', style: 'compact', expect: 'Ada(36)' },
  { dir: 'workers', file: 'packages/app/src/workers/sync.js', fn: 'render', style: 'full', expect: 'Ada (36岁)' },

  { dir: 'shared', file: 'packages/app/src/shared/userAdapter.js', fn: 'formatUserFor', style: 'compact', expect: 'Ada(36)' },
  { dir: 'shared', file: 'packages/app/src/shared/labelKit.js', fn: 'renderLabel', style: 'compact', expect: 'Ada(36)' },
];

/**
 * 检查某个目录下的调用点
 *
 * ⚠️ 两种 style 都验：
 *   · compact 那一版验"样式对了"
 *   · full 那一版验"没被改坏"
 *   （full 那一版在初始代码上输出就是对的 —— 但 core 改了签名之后，
 *     如果调用点没迁移，它会直接抛错，所以这条能抓住"漏迁移"）
 */
function assertDir(dir, group, label) {
  const bad = [];
  for (const c of APP_CALLERS.filter((x) => x.dir === group)) {
    const mod = loadMod(dir, c.file);
    if (typeof mod[c.fn] !== 'function') {
      bad.push(`${c.file}：没有导出 ${c.fn}`);
      continue;
    }
    let actual;
    try {
      actual = mod[c.fn](USER, c.style);
    } catch (e) {
      bad.push(
        `${c.file}：调 ${c.fn}(user, '${c.style}') 抛异常了（${e.message}）\n` +
          `        ⚠️ 调用点大概还没迁到新写法`,
      );
      continue;
    }
    if (actual !== c.expect) {
      bad.push(
        `${c.file}：实际 = ${JSON.stringify(actual)}，期望 = ${JSON.stringify(c.expect)}`,
      );
    }
  }
  assert.strictEqual(
    bad.length,
    0,
    `${label} 有 ${bad.length} 个调用点没迁到新写法：\n  - ${bad.join('\n  - ')}`,
  );
}

module.exports = {
  taskId: '43-hard-scale-monorepo',

  cases: [
    // ═══ 本题目标（baseline 挂 → after 过）═══
    {
      name: '⭐⭐ core 的 formatUser 支持 compact 样式',
      fn: ({ dir }) => {
        const { formatUser } = loadMod(dir, CORE_FORMAT);
        assert.strictEqual(typeof formatUser, 'function', 'formatUser 未导出');
        assert.strictEqual(
          formatUser(USER, { style: 'compact' }),
          'Ada(36)',
          'compact 样式应该是 "Ada(36)"',
        );
      },
    },
    {
      name: '⭐⭐ core 的 formatUser 拒绝旧的字符串写法（抛 TypeError）',
      fn: ({ dir }) => {
        const { formatUser } = loadMod(dir, CORE_FORMAT);
        assert.throws(
          () => formatUser(USER, 'compact'),
          (e) => e instanceof TypeError,
          '传字符串这种旧写法必须抛 TypeError —— 静默兼容等于把这个 bug 继续藏着',
        );
        assert.throws(
          () => formatUser(USER, 'full'),
          (e) => e instanceof TypeError,
          '传字符串这种旧写法必须抛 TypeError',
        );
      },
    },
    {
      name: '⭐⭐ core 的 formatUser 缺少 options 时抛 TypeError',
      fn: ({ dir }) => {
        const { formatUser } = loadMod(dir, CORE_FORMAT);
        assert.throws(
          () => formatUser(USER),
          (e) => e instanceof TypeError,
          'options 是必填的 —— 少传参数必须抛 TypeError，不能默默按 full 渲染',
        );
      },
    },
    {
      name: '⭐⭐ core 的 formatUser 拒绝未知的 style',
      fn: ({ dir }) => {
        const { formatUser } = loadMod(dir, CORE_FORMAT);
        assert.throws(
          () => formatUser(USER, { style: 'tiny' }),
          (e) => e instanceof TypeError,
          '未知的 style 必须抛 TypeError',
        );
        assert.throws(
          () => formatUser(USER, {}),
          (e) => e instanceof TypeError,
          '缺 style 也必须抛 TypeError',
        );
      },
    },
    {
      name: '⭐ core 的废弃别名 formatUsername 也跟着支持新写法',
      fn: ({ dir }) => {
        const { formatUsername } = loadMod(dir, CORE_FORMAT);
        assert.strictEqual(typeof formatUsername, 'function', 'formatUsername 未导出');
        assert.strictEqual(
          formatUsername(USER, { style: 'compact' }),
          'Ada(36)',
          'formatUsername 内部调用 formatUser —— 它也必须跟着改，否则会抛错',
        );
      },
    },
    {
      name: '⭐⭐⭐ app/features 的调用点全部迁到新写法',
      fn: ({ dir }) => {
        assertDir(dir, 'features', 'app/features');
      },
    },
    {
      name: '⭐⭐⭐ app/screens 的调用点全部迁到新写法',
      fn: ({ dir }) => {
        assertDir(dir, 'screens', 'app/screens');
      },
    },
    {
      name: '⭐⭐⭐ app/reports 的调用点全部迁到新写法',
      fn: ({ dir }) => {
        assertDir(dir, 'reports', 'app/reports');
      },
    },
    {
      name: '⭐⭐⭐ app/workers 的调用点全部迁到新写法（含转发层）',
      fn: ({ dir }) => {
        assertDir(dir, 'workers', 'app/workers');
      },
    },
    {
      name: '⭐⭐⭐ app/shared 的调用点全部迁到新写法',
      fn: ({ dir }) => {
        assertDir(dir, 'shared', 'app/shared');
      },
    },

    // ═══ 回归守卫（baseline 必须通过）═══
    {
      name: '回归守卫：core 的 full 样式输出没变',
      fn: ({ dir }) => {
        const { formatUser } = loadMod(dir, CORE_FORMAT);
        assert.strictEqual(
          formatUser(USER, { style: 'full' }),
          'Ada (36岁)',
          'full 样式的输出必须跟原来一模一样',
        );
      },
    },
    {
      name: '回归守卫：core 的其它导出没变',
      fn: ({ dir }) => {
        const { formatUserId } = loadMod(dir, 'packages/core/src/user/formatId.js');
        assert.strictEqual(formatUserId({ id: 7 }), 'U-7', 'formatUserId 被改动了');

        const { normalizeUser } = loadMod(dir, 'packages/core/src/user/normalize.js');
        assert.deepStrictEqual(
          normalizeUser({ name: 'Ada', age: 36 }),
          { id: 0, name: 'Ada', age: 36, email: '', features: [] },
          'normalizeUser 被改动了',
        );

        const { hasRole, listRoles } = loadMod(dir, 'packages/core/src/user/role.js');
        assert.strictEqual(hasRole({ roles: ['admin'] }, 'admin'), true, 'hasRole 被改动了');
        assert.deepStrictEqual(listRoles(), ['admin', 'editor', 'viewer'], 'listRoles 被改动了');

        const { avatarUrl } = loadMod(dir, 'packages/core/src/user/avatar.js');
        const url = avatarUrl({ id: 1 });
        assert.ok(
          typeof url === 'string' && url.startsWith('/avatars/') && url.endsWith('.png'),
          `avatarUrl 被改动了：${url}`,
        );
      },
    },
    {
      name: '回归守卫：app 的其它导出没变（名字像但不是一回事的那些）',
      fn: ({ dir }) => {
        const kit = loadMod(dir, 'packages/app/src/shared/userIdKit.js');
        assert.strictEqual(
          kit.formatUserTag({ name: 'Ada' }),
          'ada@example.com',
          'formatUserTag 被改动了 —— 它跟 formatUser 没关系',
        );
        assert.strictEqual(kit.id({ id: 7 }), 'U-7', 'id() 被改动了');

        const search = loadMod(dir, 'packages/app/src/features/userSearch.js');
        assert.deepStrictEqual(
          search.searchUsers([{ name: 'Ada' }], 'ad'),
          [{ id: 0, name: 'Ada', age: 0, email: '', features: [] }],
          'searchUsers 被改动了',
        );

        const perms = loadMod(dir, 'packages/app/src/features/permissions.js');
        assert.strictEqual(perms.canUse({ features: ['x'] }, 'x'), true, 'canUse 被改动了');

        const exp = loadMod(dir, 'packages/app/src/features/exportUsers.js');
        assert.deepStrictEqual(
          exp.exportRows([{ id: 7, name: 'Ada' }]),
          [['U-7', 'Ada']],
          'exportRows 被改动了',
        );
      },
    },
    {
      name: '回归守卫：core 包的导出集合没变',
      fn: ({ dir }) => {
        const core = loadMod(dir, 'packages/core/src/index.js');
        for (const k of [
          'formatUser',
          'formatUsername',
          'formatUserId',
          'normalizeUser',
          'avatarUrl',
          'hasRole',
          'listRoles',
          'createOrder',
          'orderTotal',
          'createInvoice',
          'taxOf',
          'wordCount',
          'formatMoney',
          'nextId',
        ]) {
          assert.strictEqual(typeof core[k], 'function', `core 的 ${k} 没了（导出集合被改动了）`);
        }
      },
    },
  ],
};
