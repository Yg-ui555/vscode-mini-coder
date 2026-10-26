#!/usr/bin/env node
/**
 * 46-hard-delegate-context 的初始代码生成器
 *
 * 用法：
 *   node eval/tasks/46-hard-delegate-context/_gen.js
 *
 * ⚠️ 幂等：每次都是先删 initial/ 再重建，跑一百遍结果一样。
 *
 * 为什么用生成器而不是手写 60 个文件：
 *   这道题的核心是【规模】—— 文件多到"挨个读"不可行。
 *   60 个手写文件既慢又容易出现"两个文件长得一模一样"的破绽，
 *   而这里的每一个文件都必须能自圆其说（是 handler，不是凑数的空壳）。
 *
 * 仓库构成：
 *   initial/README.md            项目说明
 *   initial/src/core/user-id.js  formatUserId 的定义
 *   initial/src/handlers/*.js    60 个 handler，一个文件一个 handler
 *
 * 60 个 handler 里有三种角色（按文件序号 i 的个位分配）：
 *   · call   （i%10 ∈ {1,2,3}，共 18 个）—— 真的【调用】了 formatUserId
 *   · mention（i%10 ∈ {4,5,6}，共 18 个）—— 只在注释 / 字符串里【提到】它
 *   · none   （其余，共 24 个）        —— 跟 formatUserId 完全无关
 *
 * ⭐ call 的三种写法都保证源码里出现 `formatUserId(` 这个形态，
 *   所以一次 grep("formatUserId\\(") 就能把 18 个真正的调用点全捞出来；
 *   mention 的两种写法里【没有】这个形态，
 *   所以 agent 必须自己判断"提到"和"调用"的区别 —— 这正是要测的东西。
 */

const fs = require('fs');
const path = require('path');

const TASK_DIR = __dirname;
const INITIAL = path.join(TASK_DIR, 'initial');

const GROUPS = [
  'user',
  'order',
  'payment',
  'inventory',
  'shipping',
  'notification',
  'report',
  'auth',
];

const TOTAL = 60;

/** 每个业务域的 handler 说明 */
const GROUP_DESC = {
  user: '用户资料相关接口。',
  order: '订单相关接口。',
  payment: '支付相关接口。',
  inventory: '库存相关接口。',
  shipping: '物流相关接口。',
  notification: '站内通知相关接口。',
  report: '报表相关接口。',
  auth: '鉴权相关接口。',
};

/** 无关 handler 的返回值（让每个文件看起来都在干自己的事） */
const NONE_BODY = {
  user: `  const q = request.query || {};
  return {
    status: 200,
    body: { name: q.name || 'anonymous', roles: q.roles || [] },
  };`,
  order: `  const q = request.query || {};
  return {
    status: 200,
    body: { orderId: q.orderId || null, state: q.state || 'new' },
  };`,
  payment: `  const q = request.query || {};
  return {
    status: 200,
    body: { paid: q.paid === true, amount: q.amount || 0 },
  };`,
  inventory: `  const q = request.query || {};
  return {
    status: 200,
    body: { sku: q.sku || null, qty: q.qty || 0 },
  };`,
  shipping: `  const q = request.query || {};
  return {
    status: 200,
    body: { waybill: q.waybill || null, carrier: q.carrier || 'unknown' },
  };`,
  notification: `  const q = request.query || {};
  return {
    status: 200,
    body: { sent: q.sent === true, channel: q.channel || 'none' },
  };`,
  report: `  const q = request.query || {};
  return {
    status: 200,
    body: { range: q.range || 'today', rows: q.rows || [] },
  };`,
  auth: `  const q = request.query || {};
  return {
    status: 200,
    body: { token: q.token || null, scopes: q.scopes || [] },
  };`,
};

/**
 * 算出第 i 个 handler 的身份
 * @returns {{i:number,name:string,group:string,role:string,style:number}}
 */
function planOf(i) {
  const group = GROUPS[(i - 1) % GROUPS.length];
  const name = `${group}-${String(i).padStart(2, '0')}.js`;
  const decile = i % 10;

  let role = 'none';
  let style = 0;
  if (decile === 1 || decile === 2 || decile === 3) {
    role = 'call';
    style = decile; // 1=直接调用 2=包一层 3=命名空间调用
  } else if (decile === 4 || decile === 5 || decile === 6) {
    role = 'mention';
    style = decile; // 4=注释里提到 5=字符串里出现
  }
  return { i, name, group, role, style };
}

/** 生成一个 handler 文件的内容 */
function handlerSource(p) {
  const head = [
    '/**',
    ` * handler: ${p.name.replace(/\.js$/, '')}`,
    ` * ${GROUP_DESC[p.group]}`,
    ' */',
    '',
  ];

  if (p.role === 'call') {
    if (p.style === 1) {
      // 直接调用
      return head
        .concat([
          "const { formatUserId } = require('../core/user-id');",
          '',
          'function handle(request) {',
          '  return {',
          '    status: 200,',
          '    body: { label: formatUserId(request.user) },',
          '  };',
          '}',
          '',
          'module.exports = { handle };',
          '',
        ])
        .join('\n');
    }
    if (p.style === 2) {
      // 包一层：调用藏在别的函数里
      return head
        .concat([
          "const { formatUserId } = require('../core/user-id');",
          '',
          'function renderOwner(owner) {',
          '  return `归属人: ${formatUserId(owner)}`;',
          '}',
          '',
          'function handle(request) {',
          '  return {',
          '    status: 200,',
          '    body: { text: renderOwner(request.owner) },',
          '  };',
          '}',
          '',
          'module.exports = { handle };',
          '',
        ])
        .join('\n');
    }
    // 命名空间调用
    return head
      .concat([
        "const userId = require('../core/user-id');",
        '',
        'function handle(request) {',
        '  return {',
        '    status: 200,',
        '    body: { label: userId.formatUserId(request.user) },',
        '  };',
        '}',
        '',
        'module.exports = { handle };',
        '',
      ])
      .join('\n');
  }

  if (p.role === 'mention') {
    if (p.style === 4) {
      // 只在注释里提到
      return head
        .concat([
          '// 这一段以前是直接调 formatUserId 拼出来的，',
          '// 后来换成了下面的模板，就别再改回去了。',
          'function handle(request) {',
          '  const q = request.query || {};',
          '  return {',
          '    status: 200,',
          "    body: { text: `库存 ${q.sku || '-'}: ${q.qty || 0}` },",
          '  };',
          '}',
          '',
          'module.exports = { handle };',
          '',
        ])
        .join('\n');
    }
    // 只在字符串里出现
    return head
      .concat([
        "// 老接口的字段名还是 formatUserId，这里保持向后兼容",
        "const LEGACY_FIELD = 'formatUserId';",
        '',
        'function handle(request) {',
        '  const q = request.query || {};',
        '  return {',
        '    status: 200,',
        '    body: { field: LEGACY_FIELD, waybill: q.waybill || null },',
        '  };',
        '}',
        '',
        'module.exports = { handle };',
        '',
      ])
      .join('\n');
  }

  // 跟 formatUserId 完全无关
  return head
    .concat([
      'function handle(request) {',
      NONE_BODY[p.group],
      '}',
      '',
      'module.exports = { handle };',
      '',
    ])
    .join('\n');
}

const README = `# handler-service

一个很朴素的 HTTP 服务：每个 handler 一个文件，handler 之间基本不互相依赖。

## 目录结构

\`\`\`
src/core/user-id.js   用户显示名的统一格式化
src/handlers/          各个业务 handler，一个文件一个 handler
\`\`\`

## 开发

- 新增 handler 就新建 \`src/handlers/<业务>-<序号>.js\`，导出一个 \`handle\` 函数。
- \`src/core/user-id.js\` 里的 \`formatUserId\` 是公共的，谁要用就 require 它。
- 没有构建步骤。改完用 \`node -e "require('./src/handlers/user-01.js')"\` 能加载就说明语法没问题。
- 新 handler 的编号接着往后排，不要重号。
`;

const USER_ID = `/**
 * 用户显示名的统一格式化。
 *
 * 全仓库都靠它把用户对象渲染成显示串：
 *   { id: 42, name: '张三', email: 'zhang@example.com' }
 *   -> "张三 <zhang@example.com> (#42)"
 */

/**
 * @param {{id: number, name: string, email?: string}} user
 * @returns {string}
 */
function formatUserId(user) {
  if (!user) return 'unknown';
  const mail = user.email ? \` <\${user.email}>\` : '';
  return \`\${user.name}\${mail} (#\${user.id})\`;
}

module.exports = { formatUserId };
`;

function main() {
  // 幂等：先删干净再重建
  if (fs.existsSync(INITIAL)) fs.rmSync(INITIAL, { recursive: true, force: true });
  fs.mkdirSync(path.join(INITIAL, 'src', 'core'), { recursive: true });
  fs.mkdirSync(path.join(INITIAL, 'src', 'handlers'), { recursive: true });

  fs.writeFileSync(path.join(INITIAL, 'README.md'), README, 'utf-8');
  fs.writeFileSync(path.join(INITIAL, 'src', 'core', 'user-id.js'), USER_ID, 'utf-8');

  let files = 0;
  for (let i = 1; i <= TOTAL; i++) {
    const p = planOf(i);
    fs.writeFileSync(path.join(INITIAL, 'src', 'handlers', p.name), handlerSource(p), 'utf-8');
    files++;
  }

  // 冒烟测试：生成的代码必须能被 node 加载
  const { execFileSync } = require('child_process');
  let smoke = '✅ 全部可加载';
  try {
    for (let i = 1; i <= TOTAL; i++) {
      const p = planOf(i);
      execFileSync(
        process.execPath,
        ['-e', 'require(' + JSON.stringify(path.join(INITIAL, 'src', 'handlers', p.name)) + ')'],
        { cwd: INITIAL, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
      );
    }
  } catch (e) {
    smoke = '❌ 加载失败：' + String(e.stderr || e.message).split('\n').slice(0, 6).join(' | ');
  }

  const plans = [];
  for (let i = 1; i <= TOTAL; i++) plans.push(planOf(i));
  const calls = plans.filter((p) => p.role === 'call').map((p) => p.name);
  const mentions = plans.filter((p) => p.role === 'mention').map((p) => p.name);

  console.log('');
  console.log('46-hard-delegate-context 初始代码已生成：');
  console.log('  handler 文件：' + files + ' 个（call ' + calls.length + ' / mention ' + mentions.length + ' / none ' +
    (TOTAL - calls.length - mentions.length) + '）');
  console.log('  冒烟测试：' + smoke);
  console.log('');
  console.log('  call   = ' + calls.join(', '));
  console.log('');
  console.log('  mention= ' + mentions.join(', '));
  console.log('');
}

main();
