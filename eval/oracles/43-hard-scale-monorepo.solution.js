/**
 * 标准答案 —— 43-hard-scale-monorepo
 *
 * 目的：证明这道题【有解】。
 *
 * 标准解法（16 处改动）：
 *   1. packages/core/src/user/format.js
 *      · formatUser 改成 (user, options)，options 必填且必须是对象
 *      · 传旧写法（字符串 / 不传 / 未知 style）一律抛 TypeError
 *      · formatUsername 这个废弃别名跟着改（它内部调用 formatUser）
 *
 *   2. app 包 15 个调用点逐个迁到 { style } 写法
 *      · features/ 4 个
 *      · screens/ 4 个（其中一个走的是 core 包总入口，不是深层路径）
 *      · reports/ 3 个
 *      · workers/ 2 个（⭐ notify.js 是变参转发，要改函数体）
 *      · shared/  2 个（⭐ style 是外部传进来的，要包成对象）
 *
 * ⚠️ 特别注意 notify.js：
 *   它的参数是 (...args) => formatUser(...args) 转发的，
 *   光把调用处的 'compact' 换成 { style: 'compact' } 是不够的 ——
 *   转发那一层也得改成具名参数，否则对象会被当成 user 传下去。
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

/** app 包里所有需要迁移的调用点 */
const APP_CALLERS = [
  'packages/app/src/features/profileCard.js',
  'packages/app/src/features/teamList.js',
  'packages/app/src/features/billingSummary.js',
  'packages/app/src/features/auditTrail.js',
  'packages/app/src/screens/userList.js',
  'packages/app/src/screens/userDetail.js',
  'packages/app/src/screens/preferences.js',
  'packages/app/src/screens/orgTree.js',
  'packages/app/src/reports/daily.js',
  'packages/app/src/reports/monthly.js',
  'packages/app/src/reports/export.js',
  'packages/app/src/workers/sync.js',
  'packages/app/src/shared/userAdapter.js',
  'packages/app/src/shared/labelKit.js',
];

/**
 * 把 app 里的旧写法批量换成新写法
 *
 * ⚠️ 顺序不能乱：先处理带参数的，再处理完全没参数的，
 *    否则 "formatUser(user)" 会先把 "formatUser(user, 'x')" 的一部分吃掉。
 */
function migrate(src, where) {
  let out = src;
  out = out.replace(/formatUser\((\w+), 'compact'\)/g, "formatUser($1, { style: 'compact' })");
  out = out.replace(/formatUser\((\w+), 'full'\)/g, "formatUser($1, { style: 'full' })");
  out = out.replace(/formatUser\((\w+), style\)/g, 'formatUser($1, { style })');
  out = out.replace(/formatUser\((\w+)\)/g, "formatUser($1, { style: 'full' })");
  if (out === src) {
    throw new Error(`标准答案锚点没找到（${where}）：没有可替换的 formatUser 调用`);
  }
  return out;
}

module.exports = {
  taskId: '43-hard-scale-monorepo',

  apply(dir) {
    // ── 1. core：改签名 + 严格校验 ──
    patch(dir, 'packages/core/src/user/format.js', (src) => {
      let out = src;

      out = replaceOnce(
        out,
        [
          'function formatUser(user) {',
          "  const name = String((user && user.name) || '');",
          '  const age = Number((user && user.age) || 0);',
          "  return name + ' (' + age + '岁)';",
          '}',
        ].join('\n'),
        [
          'function formatUser(user, options) {',
          '  // ⚠️ options 必填，而且必须是对象 ——',
          '  //    旧写法之所以能悄无声息地错这么久，就是因为它【不报错】。',
          '  //    传旧写法必须立刻炸出来，而不是继续静默地渲染错。',
          "  if (!options || typeof options !== 'object' || Array.isArray(options)) {",
          '    throw new TypeError(',
          "      'formatUser(user, options)：options 必须是对象，例如 { style: \"compact\" }；' +",
          "        '收到 ' + JSON.stringify(options),",
          '    );',
          '  }',
          '',
          "  const style = options.style;",
          "  if (style !== 'full' && style !== 'compact') {",
          '    throw new TypeError(',
          "      'formatUser：options.style 只能是 \"full\" 或 \"compact\"；' +",
          "        '收到 ' + JSON.stringify(style),",
          '    );',
          '  }',
          '',
          "  const name = String((user && user.name) || '');",
          '  const age = Number((user && user.age) || 0);',
          "  if (style === 'compact') return name + '(' + age + ')';",
          "  return name + ' (' + age + '岁)';",
          '}',
        ].join('\n'),
        'packages/core/src/user/format.js / formatUser',
      );

      out = replaceOnce(
        out,
        ['function formatUsername(user) {', '  return formatUser(user);', '}'].join('\n'),
        [
          'function formatUsername(user, options) {',
          '  return formatUser(user, options);',
          '}',
        ].join('\n'),
        'packages/core/src/user/format.js / formatUsername',
      );

      return out;
    });

    // ── 2. app：14 个直接调用点 ──
    for (const rel of APP_CALLERS) {
      patch(dir, rel, (src) => migrate(src, rel));
    }

    // ── 3. app：notify.js（变参转发）⭐ ──
    patch(dir, 'packages/app/src/workers/notify.js', (src) => {
      let out = src;

      // 转发层：具名参数，别再用 ...args
      out = replaceOnce(
        out,
        ['function formatUserForNotification(...args) {', '  return formatUser(...args);', '}'].join('\n'),
        [
          'function formatUserForNotification(user, options) {',
          '  return formatUser(user, options);',
          '}',
        ].join('\n'),
        'packages/app/src/workers/notify.js / 转发层',
      );

      // 调用点
      out = replaceOnce(
        out,
        "formatUserForNotification(user, 'compact')",
        "formatUserForNotification(user, { style: 'compact' })",
        'packages/app/src/workers/notify.js / 调用点',
      );

      return out;
    });
  },
};
