/**
 * 43-hard-scale-monorepo 的初始代码生成器
 *
 * ⭐ 这道题考什么：
 *
 *   "core 包改一个导出签名，app 包里 4 个目录的调用点都得跟着改" ——
 *   听着像体力活，实际上有三个坑：
 *
 *   1. ⭐ 旧写法是【静默失效】的，不是报错的：
 *        app 里 15 处调用有 12 处传的是字符串 'compact' / 'full'，
 *        而 core 的 formatUser 一直【忽略第二个参数】——
 *        所以那些调用点今天渲染出来的全是 full 样式，没人发现。
 *
 *   2. ⭐ 变参转发（workers/notify.js）：
 *        `(...args) => formatUser(...args)` —— 光看调用点看不出参数怎么传的，
 *        必须顺着函数体读。
 *
 *   3. ⭐ 同名干扰项：
 *        app 里还有 formatUserId / formatUserTag，
 *        名字长得像但完全不是一回事 —— 改它们等于制造回归。
 *
 * ⚠️ 规模：60+ 文件、两个包、app 包 5 个目录，
 *   15 个调用点散落在里面，靠通读是找不全的。
 */

const path = require('path');
const { writeTree, resetDir, statsOf } = require('./lib');

const TASK_ID = '43-hard-scale-monorepo';

/**
 * app 包里【会渲染用户】的模块
 *
 * call 字段写的是"最终产出格式化结果的那句表达式"，
 * 写成表达式而不是拼好的模板，是为了让 oracle 的替换锚点保持稳定。
 */
const APP_FORMATTERS = [
  {
    dir: 'features',
    file: 'profileCard.js',
    desc: '个人资料卡片',
    call: "formatUser(user, 'compact')",
    wrap: (c) => "'【' + " + c + " + '】'",
    render: 'render',
  },
  {
    dir: 'features',
    file: 'teamList.js',
    desc: '团队成员列表',
    call: "formatUser(user, 'compact')",
    render: 'render',
  },
  {
    dir: 'features',
    file: 'billingSummary.js',
    desc: '账单摘要',
    call: "formatUser(user, 'full')",
    render: 'render',
  },
  {
    dir: 'features',
    file: 'auditTrail.js',
    desc: '审计流水',
    call: 'formatUser(user)',
    render: 'render',
  },
  {
    dir: 'screens',
    file: 'userList.js',
    desc: '用户列表页',
    call: "formatUser(user, 'compact')",
    render: 'render',
  },
  {
    dir: 'screens',
    file: 'userDetail.js',
    desc: '用户详情页',
    call: "formatUser(user, 'full')",
    render: 'render',
  },
  {
    dir: 'screens',
    file: 'preferences.js',
    desc: '偏好设置页',
    call: "formatUser(user, 'compact')",
    render: 'render',
  },
  {
    dir: 'screens',
    file: 'orgTree.js',
    desc: '组织树（走 core 包的总入口，不是深层路径）',
    call: "formatUser(user, 'full')",
    render: 'render',
    fromBarrel: true,
  },
  {
    dir: 'reports',
    file: 'daily.js',
    desc: '日报',
    call: "formatUser(user, 'full')",
    render: 'render',
  },
  {
    dir: 'reports',
    file: 'monthly.js',
    desc: '月报',
    call: "formatUser(user, 'compact')",
    render: 'render',
  },
  {
    dir: 'reports',
    file: 'export.js',
    desc: '报表导出',
    call: "formatUser(user, 'full')",
    render: 'render',
  },
  {
    dir: 'workers',
    file: 'notify.js',
    desc: '通知下发（⭐ 参数是变参转发的）',
    call: "formatUserForNotification(user, 'compact')",
    render: 'render',
    variadic: true,
  },
  {
    dir: 'workers',
    file: 'sync.js',
    desc: '数据同步',
    call: "formatUser(user, 'full')",
    render: 'render',
  },
  {
    dir: 'shared',
    file: 'userAdapter.js',
    desc: '用户格式化适配层（⭐ style 是外部传进来的）',
    call: 'formatUser(user, style)',
    render: 'formatUserFor',
    paramName: 'style',
  },
  {
    dir: 'shared',
    file: 'labelKit.js',
    desc: '标签工具集（⭐ style 有默认值）',
    call: 'formatUser(user, style)',
    render: 'renderLabel',
    paramName: "style = 'full'",
  },
];

/** app 包里【不渲染用户】的模块（真实存在的噪声代码） */
const APP_NOISE = {
  'features/userSearch.js': `/**
 * 用户搜索。
 */
const { normalizeUser } = require('../../../core/src/user/normalize');

/** 按名字搜 */
function searchUsers(users, query) {
  const q = String(query || '').toLowerCase();
  if (!q) return [];
  return users
    .map((u) => normalizeUser(u))
    .filter((u) => String(u.name).toLowerCase().indexOf(q) !== -1);
}

module.exports = { searchUsers };
`,
  'features/permissions.js': `/**
 * 功能权限。
 */
const { hasRole } = require('../../../core/src/user/role');

/** 能不能用某个功能 */
function canUse(user, feature) {
  if (!user) return false;
  return hasRole(user, 'admin') || user.features.indexOf(feature) !== -1;
}

module.exports = { canUse };
`,
  'features/importUsers.js': `/**
 * 批量导入用户。
 */
const { normalizeUser } = require('../../../core/src/user/normalize');

/** 解析导入的行 */
function parseRows(rows) {
  return (rows || []).map((r) => normalizeUser({ name: r[0], age: Number(r[1]) || 0 }));
}

module.exports = { parseRows };
`,
  'features/exportUsers.js': `/**
 * 导出用户。
 */
const { formatUserId } = require('../../../core/src/user/formatId');

/** 生成导出行 */
function exportRows(users) {
  return (users || []).map((u) => [formatUserId(u), String(u.name || '')]);
}

module.exports = { exportRows };
`,
  'screens/help.js': `/**
 * 帮助页文案。
 */
const HELP = [
  '在搜索框里输入名字可以快速定位成员。',
  '按 / 聚焦搜索框，按 Esc 清空。',
];

/** 取一条帮助文案 */
function helpText(index) {
  return HELP[index % HELP.length];
}

module.exports = { helpText, HELP };
`,
  'screens/searchBox.js': `/**
 * 搜索框的纯逻辑部分。
 */
const { normalizeSpace } = require('../../../core/src/util/text');

/** 规整输入 */
function normalizeQuery(q) {
  return normalizeSpace(q);
}

/** 输入框的状态 */
function stateOf(q) {
  const text = normalizeQuery(q);
  return { text, empty: text.length === 0 };
}

module.exports = { normalizeQuery, stateOf };
`,
  'reports/summary.js': `/**
 * 报表汇总。
 */
const { formatDate } = require('../../../core/src/util/date');

/** 生成一段汇总 */
function summarize(day, counts) {
  return { day: formatDate(day), counts: counts || {} };
}

module.exports = { summarize };
`,
  'reports/trend.js': `/**
 * 趋势计算。
 */

/** 按天分组 */
function groupByDay(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const key = String(r.day || '');
    out.set(key, (out.get(key) || 0) + (Number(r.value) || 0));
  }
  return out;
}

/** 计算环比 */
function delta(current, previous) {
  if (!previous) return 0;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

module.exports = { groupByDay, delta };
`,
  'reports/audit.js': `/**
 * 审计报表。
 */
const { formatDate } = require('../../../core/src/util/date');

/** 生成审计条目 */
function auditRows(events) {
  return (events || []).map((e) => ({ at: formatDate(e.at), action: e.action }));
}

module.exports = { auditRows };
`,
  'workers/digest.js': `/**
 * 摘要任务。
 */
const { wordCount } = require('../../../core/src/util/text');

/** 生成摘要 */
function digest(text) {
  return { words: wordCount(text), at: Date.now() };
}

module.exports = { digest };
`,
  'workers/cleanup.js': `/**
 * 清理任务。
 */

/** 找出过期条目 */
function expired(items, now, ttl) {
  const cutoff = (now === undefined ? Date.now() : now) - ttl;
  return (items || []).filter((it) => it.at < cutoff);
}

module.exports = { expired };
`,
  'shared/userIdKit.js': `/**
 * 用户 ID 工具。
 *
 * ⚠️ 名字跟 formatUser 长得像，但完全不是一回事 ——
 *    它只拼 ID，从来不渲染用户名。
 */
const { formatUserId } = require('../../../core/src/user/formatId');

/** 给用户生成展示用的 ID 标签 */
function formatUserTag(user) {
  const name = String((user && user.name) || '').toLowerCase().replace(/[^a-z0-9]+/g, '.');
  return name + '@example.com';
}

/** 直接透传 core 的 ID 格式化 */
function id(user) {
  return formatUserId(user);
}

module.exports = { formatUserTag, id };
`,
  'shared/api.js': `/**
 * app 侧的 API 客户端。
 */
const { apiVersion } = require('../../../core/src');

/** 请求头 */
function headers(token) {
  return { 'x-api-version': apiVersion(), authorization: token ? 'Bearer ' + token : '' };
}

/** 拼请求地址 */
function url(path, query) {
  const q = query ? '?' + query : '';
  return '/api' + path + q;
}

module.exports = { headers, url };
`,
  'shared/logger.js': `/**
 * app 侧日志。
 */
const LEVELS = ['debug', 'info', 'warn', 'error'];

/** 格式化一条日志 */
function format(level, scope, message) {
  return '[' + level.toUpperCase() + '] ' + (scope ? scope + ': ' : '') + message;
}

/** 记一条 */
function log(level, scope, message) {
  if (LEVELS.indexOf(level) === -1) return;
  // eslint-disable-next-line no-console
  console.log(format(level, scope, message));
}

module.exports = { format, log };
`,
  'shared/config.js': `/**
 * app 侧配置。
 */
const DEFAULTS = { locale: 'zh-CN', pageSize: 20, theme: 'light' };

let current = Object.assign({}, DEFAULTS);

/** 覆盖配置 */
function configure(patch) {
  current = Object.assign({}, current, patch || {});
  return current;
}

/** 读配置 */
function get() {
  return Object.assign({}, current);
}

module.exports = { configure, get, DEFAULTS };
`,
  'utils/format.js': `/**
 * app 侧格式化。
 */
const { formatMoney } = require('../../../core/src/util/money');

/** 金额 */
function money(cents) {
  return formatMoney(cents);
}

/** 百分比 */
function percent(n) {
  return (Math.round((Number(n) || 0) * 1000) / 10).toFixed(1) + '%';
}

module.exports = { money, percent };
`,
  'utils/date.js': `/**
 * app 侧日期。
 */
const { formatDate } = require('../../../core/src/util/date');

/** 今天 */
function today() {
  return formatDate(Date.now());
}

module.exports = { today };
`,
  'utils/assert.js': `/**
 * 断言。
 */

/** 断言条件成立 */
function ok(cond, message) {
  if (!cond) throw new Error(message || '断言失败');
}

module.exports = { ok };
`,
  'utils/id.js': `/**
 * app 侧 ID。
 */
const { nextId } = require('../../../core/src/util/id');

/** 生成一个会话 ID */
function sessionId(prefix) {
  return (prefix || 's') + '-' + nextId('app');
}

module.exports = { sessionId };
`,
};

/** core 包里跟用户有关的模块 */
const CORE_USER_FILES = {
  'format.js': `/**
 * 用户显示格式化。
 *
 * ⚠️ 目前只认一种风格（full）。app 包里有不少调用点【已经在传第二个参数】了，
 *    但这个函数一直把它忽略了 —— 也就是说那些调用点渲染出来的结果
 *    跟调用方【以为的】不一样，而且从头到尾没有任何报错。
 *
 *    这个"静默"才是问题：调用方以为在用紧凑样式，实际拿到的是完整样式。
 */
function formatUser(user) {
  const name = String((user && user.name) || '');
  const age = Number((user && user.age) || 0);
  return name + ' (' + age + '岁)';
}

/**
 * 已废弃的别名 —— 老代码还在用它。
 *
 * ⚠️ 它内部调的就是 formatUser，所以改签名的时候它也得跟着改。
 */
function formatUsername(user) {
  return formatUser(user);
}

module.exports = { formatUser, formatUsername };
`,
  'formatId.js': `/**
 * 用户 ID 格式化。
 *
 * ⚠️ 只拼 ID，不渲染名字 —— 名字长得像 formatUser，但完全是两回事。
 */
function formatUserId(user) {
  const id = (user && user.id) || 0;
  return 'U-' + id;
}

module.exports = { formatUserId };
`,
  'normalize.js': `/**
 * 用户对象标准化 —— 把各种形状的用户对象抹平成统一结构。
 */
function normalizeUser(raw) {
  const u = raw || {};
  return {
    id: Number(u.id) || 0,
    name: String(u.name || ''),
    age: Number(u.age) || 0,
    email: String(u.email || ''),
    features: Array.isArray(u.features) ? u.features.slice() : [],
  };
}

module.exports = { normalizeUser };
`,
  'avatar.js': `/**
 * 头像地址。
 */
const { simpleHash } = require('../util/hash');

/** 由用户 id 派生一个头像地址 */
function avatarUrl(user) {
  const id = (user && user.id) || 0;
  return '/avatars/' + simpleHash('avatar:' + id) + '.png';
}

module.exports = { avatarUrl };
`,
  'role.js': `/**
 * 角色判断。
 */
const ROLES = ['admin', 'editor', 'viewer'];

/** 有没有某个角色 */
function hasRole(user, role) {
  if (!user || !Array.isArray(user.roles)) return false;
  return user.roles.indexOf(role) !== -1;
}

/** 全部角色 */
function listRoles() {
  return ROLES.slice();
}

module.exports = { hasRole, listRoles };
`,
};

/** core 包里订单 / 账单 / 工具模块（噪声代码，但要是真的） */
const CORE_OTHER_FILES = {
  'order/create.js': `/**
 * 创建订单。
 */
const { nextId } = require('../util/id');

/** 造一个订单 */
function createOrder(items, userId) {
  return {
    id: nextId('order'),
    userId: Number(userId) || 0,
    items: (items || []).slice(),
    at: Date.now(),
  };
}

module.exports = { createOrder };
`,
  'order/total.js': `/**
 * 订单金额计算。
 */
const { sum } = require('../util/money');

/** 订单总价（分） */
function orderTotal(order) {
  return sum((order && order.items) || []);
}

module.exports = { orderTotal };
`,
  'order/status.js': `/**
 * 订单状态流转。
 */
const FLOW = ['created', 'paid', 'packed', 'shipped', 'done', 'cancelled'];

/** 下一个状态 */
function nextStatus(status) {
  const i = FLOW.indexOf(status);
  if (i === -1 || i === FLOW.length - 1) return null;
  return FLOW[i + 1];
}

/** 是否是终态 */
function isFinal(status) {
  return status === 'done' || status === 'cancelled';
}

module.exports = { nextStatus, isFinal, FLOW };
`,
  'order/discount.js': `/**
 * 折扣计算。
 */
const RULES = [
  { code: 'NEW10', off: 0.1 },
  { code: 'VIP20', off: 0.2 },
];

/** 找折扣规则 */
function findRule(code) {
  return RULES.filter((r) => r.code === code)[0] || null;
}

/** 折后金额（分） */
function applyDiscount(amount, code) {
  const rule = findRule(code);
  if (!rule) return Math.round(Number(amount) || 0);
  return Math.round((Number(amount) || 0) * (1 - rule.off));
}

module.exports = { findRule, applyDiscount };
`,
  'order/refund.js': `/**
 * 退款单。
 */
const { nextId } = require('../util/id');

/** 造一张退款单 */
function createRefund(order, amount) {
  return { id: nextId('refund'), orderId: order && order.id, amount: Math.round(amount) || 0 };
}

module.exports = { createRefund };
`,
  'billing/invoice.js': `/**
 * 发票。
 */
const { nextId } = require('../util/id');

/** 造一张发票 */
function createInvoice(userId, amount) {
  return { id: nextId('inv'), userId: Number(userId) || 0, amount: Math.round(amount) || 0 };
}

module.exports = { createInvoice };
`,
  'billing/tax.js': `/**
 * 税率。
 */
const RATES = { default: 0.06, reduced: 0.03 };

/** 算税 */
function taxOf(amount, kind) {
  const rate = RATES[kind] === undefined ? RATES.default : RATES[kind];
  return Math.round((Number(amount) || 0) * rate);
}

module.exports = { taxOf, RATES };
`,
  'billing/plan.js': `/**
 * 订阅计划。
 */
const PLANS = {
  basic: { price: 9900, seats: 1 },
  pro: { price: 29900, seats: 5 },
};

/** 查计划 */
function getPlan(name) {
  return PLANS[name] || null;
}

module.exports = { getPlan, PLANS };
`,
  'billing/lineItem.js': `/**
 * 账单明细行。
 */

/** 造一行明细 */
function lineItem(name, amount, qty) {
  return { name: String(name || ''), amount: Math.round(amount) || 0, qty: Math.max(1, Number(qty) || 1) };
}

/** 明细行合计 */
function sumLines(lines) {
  let total = 0;
  for (const l of lines || []) total += l.amount * l.qty;
  return total;
}

module.exports = { lineItem, sumLines };
`,
  'billing/statement.js': `/**
 * 对账单。
 */
const { formatDate } = require('../util/date');

/** 生成对账单 */
function statement(userId, month, amount) {
  return { userId: Number(userId) || 0, month: String(month || ''), amount: Math.round(amount) || 0, at: formatDate() };
}

module.exports = { statement };
`,
  'util/text.js': `/**
 * 文本工具。
 */

/** 词数 */
function wordCount(text) {
  return String(text == null ? '' : text).split(/\\s+/).filter(Boolean).length;
}

/** 压缩空白 */
function normalizeSpace(text) {
  return String(text == null ? '' : text).replace(/\\s+/g, ' ').trim();
}

/** 截断 */
function clip(text, max) {
  const s = String(text == null ? '' : text);
  return s.length > max ? s.slice(0, max) : s;
}

module.exports = { wordCount, normalizeSpace, clip };
`,
  'util/date.js': `/**
 * 日期工具（UTC）。
 */

/** 格式化成 YYYY-MM-DD */
function formatDate(ts) {
  const d = new Date(ts === undefined ? Date.now() : ts);
  return d.toISOString().slice(0, 10);
}

/** 加天数 */
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = { formatDate, addDays };
`,
  'util/money.js': `/**
 * 金额工具（按分算）。
 */

/** 格式化成 ¥12.34 */
function formatMoney(cents) {
  return '¥' + ((Number(cents) || 0) / 100).toFixed(2);
}

/** 求和 */
function sum(items) {
  let total = 0;
  for (const it of items || []) total += Number(it.amount) || 0;
  return total;
}

module.exports = { formatMoney, sum };
`,
  'util/id.js': `/**
 * ID 生成。
 *
 * ⚠️ 用计数器而不是随机数 —— 评测要求可复现。
 */
let counter = 0;

/** 生成一个带前缀的 ID */
function nextId(prefix) {
  counter += 1;
  return String(prefix || 'id') + '-' + counter.toString(36);
}

/** 重置计数器（测试用） */
function reset() {
  counter = 0;
}

module.exports = { nextId, reset };
`,
  'util/hash.js': `/**
 * 简单哈希。
 */

/** djb2 变体 */
function simpleHash(s) {
  const str = String(s == null ? '' : s);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

module.exports = { simpleHash };
`,
  'util/assert.js': `/**
 * 断言。
 */

/** 断言条件成立 */
function ok(cond, message) {
  if (!cond) throw new Error(message || '断言失败');
}

/** 断言值相等 */
function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || '值不相等') + '：实际=' + JSON.stringify(actual) + ' 期望=' + JSON.stringify(expected));
  }
}

module.exports = { ok, equal };
`,
};

module.exports = {
  TASK_ID,
  smoke: 'packages/app/src/index.js',
  generate(taskDir) {
    const initialDir = path.join(taskDir, 'initial');
    resetDir(initialDir);

    const files = [];
    const push = (rel, content) => files.push({ rel, content });

    // ── 根 ──
    push(
      'package.json',
      `{
  "name": "workspace-root",
  "private": true,
  "workspaces": [
    "packages/*"
  ]
}
`,
    );
    push(
      'README.md',
      `# workspace

一个 npm workspaces 风格的两包仓库。

| 包 | 路径 | 说明 |
|---|---|---|
| \`@wxu/core\` | \`packages/core/\` | 通用能力：用户、订单、账单、工具 |
| \`@wxu/app\` | \`packages/app/\` | 应用层：页面、报表、后台任务 |

## 依赖规矩

- \`core\` 不依赖 \`app\`
- \`app\` 依赖 \`core\`

## 关于跨包引用

沙箱里没有做 workspace 链接（跑不起 \`npm install\`），
所以跨包引用统一走【相对路径】：

\`\`\`js
const { formatUser } = require('../../../core/src/user/format');
\`\`\`

⚠️ 注意：有的模块走深层路径，有的走包的总入口 —— 两种都有，
改签名的时候别只改其中一种。
`,
    );

    // ── core 包 ──
    push(
      'packages/core/package.json',
      `{
  "name": "@wxu/core",
  "version": "1.3.0",
  "main": "src/index.js"
}
`,
    );
    for (const [name, content] of Object.entries(CORE_USER_FILES)) {
      push('packages/core/src/user/' + name, content);
    }
    push(
      'packages/core/src/user/index.js',
      `/**
 * 用户相关能力的汇总。
 */
const format = require('./format');
const formatId = require('./formatId');
const normalize = require('./normalize');
const avatar = require('./avatar');
const role = require('./role');

module.exports = {
  formatUser: format.formatUser,
  formatUsername: format.formatUsername,
  formatUserId: formatId.formatUserId,
  normalizeUser: normalize.normalizeUser,
  avatarUrl: avatar.avatarUrl,
  hasRole: role.hasRole,
  listRoles: role.listRoles,
};
`,
    );
    for (const [name, content] of Object.entries(CORE_OTHER_FILES)) {
      const sub = name.includes('/') ? name.split('/')[0] : 'util';
      const base = name.includes('/') ? name.split('/')[1] : name;
      push('packages/core/src/' + sub + '/' + base, content);
    }
    push(
      'packages/core/src/order/index.js',
      `/**
 * 订单相关能力的汇总。
 */
const create = require('./create');
const total = require('./total');
const status = require('./status');
const discount = require('./discount');
const refund = require('./refund');

module.exports = {
  createOrder: create.createOrder,
  orderTotal: total.orderTotal,
  nextStatus: status.nextStatus,
  isFinal: status.isFinal,
  findRule: discount.findRule,
  applyDiscount: discount.applyDiscount,
  createRefund: refund.createRefund,
};
`,
    );
    push(
      'packages/core/src/billing/index.js',
      `/**
 * 账单相关能力的汇总。
 */
const invoice = require('./invoice');
const tax = require('./tax');
const plan = require('./plan');
const lineItem = require('./lineItem');
const statement = require('./statement');

module.exports = {
  createInvoice: invoice.createInvoice,
  taxOf: tax.taxOf,
  getPlan: plan.getPlan,
  lineItem: lineItem.lineItem,
  sumLines: lineItem.sumLines,
  statement: statement.statement,
};
`,
    );
    push(
      'packages/core/src/util/index.js',
      `/**
 * 工具能力的汇总。
 */
const text = require('./text');
const date = require('./date');
const money = require('./money');
const id = require('./id');
const hash = require('./hash');
const assert = require('./assert');

module.exports = {
  wordCount: text.wordCount,
  normalizeSpace: text.normalizeSpace,
  clip: text.clip,
  formatDate: date.formatDate,
  addDays: date.addDays,
  formatMoney: money.formatMoney,
  sum: money.sum,
  nextId: id.nextId,
  simpleHash: hash.simpleHash,
  ok: assert.ok,
  equal: assert.equal,
};
`,
    );
    push(
      'packages/core/src/index.js',
      `/**
 * core 包的总入口。
 */
const user = require('./user');
const order = require('./order');
const billing = require('./billing');
const util = require('./util');

module.exports = Object.assign({}, user, order, billing, util, {
  coreVersion: '1.3.0',
});
`,
    );

    // ── app 包 ──
    push(
      'packages/app/package.json',
      `{
  "name": "@wxu/app",
  "version": "0.9.0",
  "main": "src/index.js"
}
`,
    );
    push(
      'packages/app/src/index.js',
      `/**
 * app 包的总入口。
 */
const shared = require('./shared/userAdapter');
const labels = require('./shared/labelKit');
const ids = require('./shared/userIdKit');
const logger = require('./shared/logger');
const config = require('./shared/config');

module.exports = {
  formatUserFor: shared.formatUserFor,
  renderLabel: labels.renderLabel,
  formatUserTag: ids.formatUserTag,
  log: logger.log,
  config: config.get,
};
`,
    );

    // 15 个"会渲染用户"的模块
    for (const m of APP_FORMATTERS) {
      const rel = 'packages/app/src/' + m.dir + '/' + m.file;
      const importPath = m.fromBarrel ? '../../../core/src' : '../../../core/src/user/format';
      const importName = m.fromBarrel ? 'formatUser' : 'formatUser';
      const lines = [];

      lines.push('/**');
      lines.push(' * ' + m.desc);
      lines.push(' */');
      lines.push(
        m.fromBarrel
          ? "const { formatUser } = require('../../../core/src');"
          : "const { formatUser } = require('../../../core/src/user/format');",
      );
      lines.push('');

      if (m.variadic) {
        lines.push('/**');
        lines.push(' * ⭐ 通知文案要支持任意参数，所以这里做了一层变参转发。');
        lines.push(' */');
        lines.push('function formatUserForNotification(...args) {');
        lines.push('  return formatUser(...args);');
        lines.push('}');
        lines.push('');
      }

      const params = m.paramName
        ? 'user, ' + m.paramName
        : 'user';
      const callExpr = m.variadic
        ? m.call
        : m.paramName
          ? m.call
          : m.call;
      const bodyExpr = m.wrap ? m.wrap(callExpr) : callExpr;

      lines.push('/** 渲染一行 */');
      lines.push('function ' + m.render + '(' + params + ') {');
      lines.push('  return ' + bodyExpr + ';');
      lines.push('}');
      lines.push('');
      lines.push('module.exports = { ' + m.render + ' };');
      lines.push('');

      push(rel, lines.join('\n'));
    }

    // 噪声模块
    for (const [rel, content] of Object.entries(APP_NOISE)) {
      push('packages/app/src/' + rel, content);
    }

    writeTree(initialDir, files);
    return statsOf(initialDir);
  },
};
