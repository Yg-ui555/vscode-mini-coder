/**
 * 41-hard-scale-callgraph 的初始代码生成器
 *
 * ⭐ 这道题考什么：
 *
 *   现有题目的代码库只有 5-9 个文件，"通读"就够，规模根本没成为瓶颈
 *   （见 eval/ABLATION.md）。这道题把仓库撑到 70 个文件、11 个目录，
 *   并且埋了一个【静态搜索搜不到的调用点】：
 *
 *   · 内置 handler 在自己的文件里调 register() 自注册
 *     → 顺着 import 链找不到它们，只能靠 grep 内容或 glob 文件名
 *   · 扩展插件（src/extensions/*.plugin.js）根本不调 register()
 *     → grep "register(" 一个都搜不到，必须读加载器才知道有这么一批
 *
 *   所以正确的解法有两条：
 *     1. grep 内容（找 kind: / register(）—— 但要意识到插件用的是另一套写法
 *     2. 跑 `node index.js --list-kinds` 探测【运行期】注册了哪些 kind，
 *        跟 grep 到的数量对不上，就知道漏了一批
 *
 * ⚠️ 坑的位置（故意留的）：
 *   billing.refund / inventory.reserve / shipping.dispatch / notify.digest
 *   → 4 个内置 handler 返回裸值
 *   ext.backup / ext.reindex
 *   → 2 个扩展插件返回裸值（这两个是"grep register( 搜不到"的那一批）
 */

const path = require('path');
const { writeTree, resetDir, writeFile, statsOf } = require('./lib');

const TASK_ID = '41-hard-scale-callgraph';

/** 内置 handler 的分组 */
const CORE_GROUPS = [
  {
    dir: 'billing',
    label: '账单域',
    handlers: [
      { name: 'invoice', desc: '生成应收明细' },
      { name: 'refund', desc: '发起退款', bad: true },
      { name: 'subscription', desc: '计算订阅续费' },
      { name: 'dunning', desc: '催缴策略' },
      { name: 'payout', desc: '结算打款' },
      { name: 'tax', desc: '计算税费' },
    ],
  },
  {
    dir: 'inventory',
    label: '库存域',
    handlers: [
      { name: 'stock', desc: '查询库存水位' },
      { name: 'reserve', desc: '预占库存', bad: true },
      { name: 'reorder', desc: '补货建议' },
      { name: 'shrink', desc: '库存损耗对账' },
      { name: 'audit', desc: '库存盘点' },
      { name: 'transfer', desc: '调拨单据' },
    ],
  },
  {
    dir: 'shipping',
    label: '履约域',
    handlers: [
      { name: 'label', desc: '生成面单' },
      { name: 'rate', desc: '计算运费' },
      { name: 'track', desc: '轨迹查询' },
      { name: 'dispatch', desc: '下发配送', bad: true },
      { name: 'customs', desc: '报关信息' },
      { name: 'returnOrder', desc: '退货处理' },
    ],
  },
  {
    dir: 'notify',
    label: '通知域',
    handlers: [
      { name: 'email', desc: '邮件通知' },
      { name: 'sms', desc: '短信通知' },
      { name: 'push', desc: '推送通知' },
      { name: 'webhook', desc: 'Webhook 回调' },
      { name: 'digest', desc: '汇总摘要', bad: true },
      { name: 'preference', desc: '通知偏好' },
    ],
  },
];

/** 扩展插件 —— 由加载器在运行期扫目录发现，文件里没有 register() */
const PLUGINS = [
  { name: 'metrics', desc: '指标汇总' },
  { name: 'audit', desc: '审计留痕' },
  { name: 'backup', desc: '数据备份', bad: true },
  { name: 'reindex', desc: '重建索引', bad: true },
  { name: 'throttle', desc: '限流保护' },
  { name: 'quota', desc: '配额校验' },
];

/**
 * 内置 handler 文件
 *
 * ⚠️ bad:true 的那几份【故意】不引入 contract、也不调 ok()，
 *    直接 return 裸对象 —— 它们就是本题要修的目标。
 */
function coreHandlerFile(group, handler) {
  const kind = `${group.dir}.${handler.name}`;
  const rel = `src/handlers/${group.dir}/${handler.name}.js`;
  const needsContract = !handler.bad;

  const body = handler.bad
    ? `function run(input) {
  const amount = Math.round(Number(input.amount) || 0);
  const label = String(input.label == null ? '' : input.label);
  return { group: '${group.dir}', name: '${handler.name}', amount, label, total: amount * 2 };
}`
    : `function run(input) {
  const amount = Math.round(Number(input.amount) || 0);
  const label = String(input.label == null ? '' : input.label);
  return ok({ group: '${group.dir}', name: '${handler.name}', amount, label, total: amount * 2 });
}`;

  const content = `/**
 * ${group.label} · ${handler.desc}
 *
 * 内置 handler 采用【自注册】：这个文件被 require 的同时把自己登记进注册表，
 * 这样新增一个 handler 不用去改任何中央清单。
 */
const { register } = require('../../core/registry');
${needsContract ? "const { ok } = require('../../core/contract');\n" : ''}
${body}

register('${kind}', run);

module.exports = { kind: '${kind}', run };
`;
  return { rel, content };
}

/** 分组索引：把本组所有 handler 收进一个数组 */
function groupIndexFile(group) {
  const names = group.handlers.map((h) => h.name);
  const lines = names.map((n) => `const ${n} = require('./${n}');`).join('\n');
  const content = `/**
 * ${group.label}的内置 handler 清单。
 *
 * 这里的 require 有两个作用：
 *   1. 让 handler 文件被加载（自注册就是这么发生的）
 *   2. 把它们汇总成一个数组交给加载器
 */
${lines}

module.exports = [${names.join(', ')}];
`;
  return { rel: `src/handlers/${group.dir}/index.js`, content };
}

/** 扩展插件文件 —— 没有 register()，靠加载器统一登记 */
function pluginFile(plugin) {
  const kind = `ext.${plugin.name}`;
  const needsContract = !plugin.bad;
  const body = plugin.bad
    ? `function run(input) {
  const amount = Math.round(Number(input.amount) || 0);
  const label = String(input.label == null ? '' : input.label);
  return { group: 'ext', name: '${plugin.name}', amount, label, total: amount * 2 };
}`
    : `function run(input) {
  const amount = Math.round(Number(input.amount) || 0);
  const label = String(input.label == null ? '' : input.label);
  return ok({ group: 'ext', name: '${plugin.name}', amount, label, total: amount * 2 });
}`;

  const content = `/**
 * 扩展插件 · ${plugin.desc}
 *
 * ⚠️ 插件跟内置 handler 的登记方式【不一样】：
 *    内置 handler 自己调 register()，插件不调 —— 插件由加载器在运行期统一登记。
 *    所以在这个文件里 grep "register(" 是搜不到它的。
 */
${needsContract ? "const { ok } = require('../core/contract');\n" : ''}
${body}

module.exports = { kind: '${kind}', run };
`;
  return { rel: `src/extensions/${plugin.name}.plugin.js`, content };
}

/** 内核文件 */
const CORE_FILES = [
  {
    rel: 'src/core/contract.js',
    content: `/**
 * 结果契约 —— 所有 job 的 run() 都必须返回这个形状。
 *
 * 为什么要单独一个文件：
 *   调用方（pipeline / adapters）只认这一种形状。
 *   一旦某个 job 偷偷返回了裸值，调用方就会拿到 undefined.data，
 *   然后在【别的地方】炸掉 —— 排查成本极高。
 *
 *   契约写在独立文件里，是为了让"哪些地方该用它"一眼能搜到。
 */

/** 成功 */
function ok(data) {
  return { ok: true, data };
}

/** 失败（不抛异常的失败） */
function fail(error) {
  return { ok: false, error: String(error) };
}

/**
 * 判断一个返回值是不是合规的结果对象。
 *
 * ⚠️ 这里只检查形状，不检查 data 的内容 ——
 *   data 是什么由各个 job 自己负责，契约层管不了也不该管。
 */
function isOutcome(value) {
  return !!value && typeof value === 'object' && typeof value.ok === 'boolean';
}

module.exports = { ok, fail, isOutcome };
`,
  },
  {
    rel: 'src/core/registry.js',
    content: `/**
 * job 注册表 —— kind → run 函数的映射。
 *
 * ⚠️ 这里【不做任何归一化】：run 返回什么就透传什么。
 *    归一化是 contract 层的事，由各个 job 自己负责。
 *    这么分是为了"谁没遵守契约"能一眼定位到具体文件。
 */
const handlers = new Map();

/** 注册一个 job */
function register(kind, run) {
  if (typeof kind !== 'string' || !kind) {
    throw new TypeError('register(kind, run)：kind 必须是非空字符串');
  }
  if (typeof run !== 'function') {
    throw new TypeError('register(kind, run)：run 必须是函数');
  }
  handlers.set(kind, run);
}

/** 取一个 job，取不到返回 undefined */
function get(kind) {
  return handlers.get(kind);
}

/** 当前注册的全部 kind（排序后返回，方便对比） */
function kinds() {
  return Array.from(handlers.keys()).sort();
}

/**
 * 按 kind 分发。
 *
 * ⚠️ 找不到 kind 时抛错，而不是返回 undefined ——
 *   让"调错了"变成一个响亮的失败，而不是后面某处 undefined.xxx 的哑错误。
 */
function dispatch(kind, input) {
  const run = handlers.get(kind);
  if (!run) throw new Error('Unknown job kind: ' + kind);
  return run(input);
}

module.exports = { register, get, kinds, dispatch };
`,
  },
  {
    rel: 'src/core/loader.js',
    content: `/**
 * 加载器 —— 负责把 job 实现塞进注册表。
 *
 * ⚠️ 内置 handler 和扩展插件是【两套完全不同的加载方式】：
 *
 *    · 内置 handler：在自己的文件里调 register() 自注册，
 *      src/handlers/index.js 负责把各组 require 进来
 *
 *    · 扩展插件：文件自己【不】注册任何人，
 *      是这里在运行期扫目录才发现的
 *
 *   两者最终都会出现在同一个注册表里。
 */
const fs = require('fs');
const path = require('path');
const registry = require('./registry');

/** 扩展插件目录 */
const PLUGIN_DIR = path.join(__dirname, '..', 'extensions');

/** 载入内置 handler（静态 require，编译期就能看见全部） */
function loadCoreHandlers() {
  require('../handlers');
  return registry;
}

/**
 * 载入扩展插件 —— 运行期扫目录。
 *
 * ⚠️ 这里没有任何静态 import 指向插件文件：
 *    顺着 import 链是【找不到】它们的。
 *    只有跑一遍这个函数，才知道当前到底有哪些扩展插件。
 *
 *    插件的命名约定是 *.plugin.js —— 用普通后缀的文件会被跳过。
 */
function loadPlugins() {
  if (!fs.existsSync(PLUGIN_DIR)) return [];
  const loaded = [];
  for (const file of fs.readdirSync(PLUGIN_DIR).sort()) {
    if (!file.endsWith('.plugin.js')) continue;
    const mod = require(path.join(PLUGIN_DIR, file));
    if (!mod || typeof mod.kind !== 'string' || typeof mod.run !== 'function') continue;
    registry.register(mod.kind, mod.run);
    loaded.push(mod.kind);
  }
  return loaded;
}

/** 全量加载 */
function loadAll() {
  loadCoreHandlers();
  loadPlugins();
  return registry;
}

module.exports = { loadCoreHandlers, loadPlugins, loadAll, PLUGIN_DIR };
`,
  },
  {
    rel: 'src/core/config.js',
    content: `/**
 * 运行期配置。
 *
 * 真实的项目里这些值来自环境变量 / 配置文件，
 * 这里用一组默认值兜底，保证沙箱里能直接跑。
 */
const DEFAULTS = {
  env: 'development',
  logLevel: 'info',
  timeoutMs: 30000,
  maxRetries: 3,
};

let current = { ...DEFAULTS };

/** 覆盖部分配置 */
function configure(patch) {
  current = { ...current, ...(patch || {}) };
  return current;
}

/** 读当前配置 */
function get() {
  return { ...current };
}

/** 恢复到默认值（测试用） */
function reset() {
  current = { ...DEFAULTS };
  return current;
}

module.exports = { configure, get, reset, DEFAULTS };
`,
  },
  {
    rel: 'src/core/errors.js',
    content: `/**
 * 错误类型。
 *
 * 分成"业务错误"和"系统错误"是为了让调用方能区别对待：
 *   业务错误 → 可以重试或者降级
 *   系统错误 → 重试也没用，直接往上抛
 */

/** 业务错误：调用方能理解、能处理的 */
class JobError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'JobError';
    this.code = code || 'JOB_ERROR';
  }
}

/** 系统错误：代码 bug 或者依赖挂了 */
class FatalError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'FatalError';
    this.cause = cause;
  }
}

/** 判断是不是业务错误 */
function isJobError(e) {
  return !!e && e.name === 'JobError';
}

module.exports = { JobError, FatalError, isJobError };
`,
  },
  {
    rel: 'src/core/events.js',
    content: `/**
 * 极简事件总线 —— job 跑完发个信号，方便上层挂钩子。
 */
const handlers = new Map();

/** 订阅事件 */
function on(event, fn) {
  if (!handlers.has(event)) handlers.set(event, []);
  handlers.get(event).push(fn);
  return () => off(event, fn);
}

/** 退订 */
function off(event, fn) {
  const list = handlers.get(event);
  if (!list) return;
  const i = list.indexOf(fn);
  if (i !== -1) list.splice(i, 1);
}

/**
 * 触发事件。
 *
 * ⚠️ 单个订阅者抛错不能影响其他订阅者 ——
 *   通知失败不该把业务流程带崩。
 */
function emit(event, payload) {
  const list = handlers.get(event) || [];
  for (const fn of list.slice()) {
    try {
      fn(payload);
    } catch (e) {
      // 订阅者的错误不该冒泡
    }
  }
  return list.length;
}

module.exports = { on, off, emit };
`,
  },
  {
    rel: 'src/core/logger.js',
    content: `/**
 * 简易日志器。
 *
 * ⚠️ 这里刻意不引三方库 —— 沙箱里没有 node_modules，
 *    依赖越少，评测跑起来越稳。
 */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

let currentLevel = LEVELS.info;

/** 设置日志级别 */
function setLevel(name) {
  if (Object.prototype.hasOwnProperty.call(LEVELS, name)) currentLevel = LEVELS[name];
}

/** 格式化一条日志 */
function format(level, scope, message) {
  const stamp = new Date().toISOString();
  return '[' + stamp + '] ' + level.toUpperCase().padEnd(5) + ' ' + (scope ? scope + ': ' : '') + message;
}

/** 记一条日志 */
function log(level, scope, message) {
  if (LEVELS[level] > currentLevel) return;
  // eslint-disable-next-line no-console
  console.log(format(level, scope, message));
}

module.exports = {
  setLevel,
  log,
  error: (scope, m) => log('error', scope, m),
  warn: (scope, m) => log('warn', scope, m),
  info: (scope, m) => log('info', scope, m),
  debug: (scope, m) => log('debug', scope, m),
};
`,
  },
  {
    rel: 'src/core/metrics.js',
    content: `/**
 * 计数器 / 计时器。
 *
 * ⚠️ 计时用 process.hrtime.bigint 而不是 Date.now() ——
 *    Date.now() 是毫秒级，单次调用误差能到 10% 以上。
 */
const counters = new Map();
const timers = new Map();

/** 加一 */
function increment(name, delta) {
  const step = delta === undefined ? 1 : delta;
  counters.set(name, (counters.get(name) || 0) + step);
  return counters.get(name);
}

/** 读一个计数器 */
function count(name) {
  return counters.get(name) || 0;
}

/** 开始计时 */
function startTimer(name) {
  timers.set(name, process.hrtime.bigint());
}

/**
 * 结束计时，返回毫秒（保留 3 位小数）。
 *
 * ⚠️ 没开始就结束 → 返回 0，而不是抛错：
 *   计时是观测手段，不该成为业务失败的原因。
 */
function stopTimer(name) {
  const started = timers.get(name);
  if (started === undefined) return 0;
  timers.delete(name);
  const ns = Number(process.hrtime.bigint() - started);
  return Math.round(ns / 1000) / 1000;
}

/** 导出当前所有计数器（快照） */
function snapshot() {
  const out = {};
  for (const [k, v] of counters) out[k] = v;
  return out;
}

module.exports = { increment, count, startTimer, stopTimer, snapshot };
`,
  },
  {
    rel: 'src/core/retry.js',
    content: `/**
 * 重试 —— 带指数退避的同步重试。
 *
 * ⚠️ 只重试【可重试】的错误：
 *   参数写错了重试一万次也没用，纯属浪费。
 */
const { JobError } = require('./errors');

/**
 * 跑一个可能失败的操作。
 *
 * @param {function} fn          要跑的函数
 * @param {number}   [retries]   最多重试几次（不含首次）
 * @param {function} [shouldRetry] 判定这个错误该不该重试
 */
function withRetry(fn, retries, shouldRetry) {
  const max = retries === undefined ? 3 : retries;
  const retryable = shouldRetry || ((e) => e && e.name === 'JobError');
  let lastError = null;

  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      return fn(attempt);
    } catch (e) {
      lastError = e;
      if (!retryable(e) || attempt === max) break;
    }
  }
  throw lastError;
}

/** 指数退避的等待时长（毫秒） */
function backoff(attempt, base) {
  const b = base === undefined ? 50 : base;
  return b * Math.pow(2, attempt);
}

module.exports = { withRetry, backoff };
`,
  },
  {
    rel: 'src/core/timer.js',
    content: `/**
 * 时间工具 —— 全部走 UTC，避免测试在本地时区下 flaky。
 */

/** 当前时间戳（毫秒） */
function now() {
  return Date.now();
}

/** 当前时间的 ISO 串 */
function isoNow() {
  return new Date().toISOString();
}

/**
 * 把时间戳格式化成 YYYY-MM-DD。
 *
 * ⚠️ 手工切 UTC 字段，而不是 toLocaleDateString() ——
 *    toLocaleDateString 受运行环境时区影响，评测在不同机器上结果会不一样。
 */
function formatDate(ts) {
  const d = new Date(ts === undefined ? Date.now() : ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/** 两个时间戳之间差了多少秒 */
function diffSeconds(a, b) {
  return Math.round((a - b) / 1000);
}

module.exports = { now, isoNow, formatDate, diffSeconds };
`,
  },
  {
    rel: 'src/core/context.js',
    content: `/**
 * 调用上下文 —— 跟着一次执行走的东西（trace id、租户、用户）。
 *
 * ⚠️ 用 AsyncLocalStorage 的话在 CommonJS 里比较绕，
 *    这里用最简单的"显式传参 + 浅拷贝"，
 *    好处是行为完全可预测，评测里对拍不会莫名其妙不一致。
 */

/** 造一个空上下文 */
function create(fields) {
  return Object.assign({ traceId: '', tenant: '', user: '' }, fields || {});
}

/** 派生一个子上下文（不改原来的） */
function derive(ctx, patch) {
  return Object.assign({}, ctx, patch || {});
}

/** 读一个字段，缺失时给默认值 */
function pick(ctx, key, fallback) {
  if (!ctx || ctx[key] === undefined) return fallback;
  return ctx[key];
}

/** 生成一个 trace id */
function newTraceId(seed) {
  const s = seed === undefined ? Date.now() : seed;
  return 'trace-' + s.toString(36);
}

module.exports = { create, derive, pick, newTraceId };
`,
  },
];

/** 适配层 —— 真实存在的噪声代码 */
const ADAPTER_FILES = [
  {
    rel: 'src/adapters/http.js',
    content: `/**
 * HTTP 适配层 —— 把 job 结果包成 HTTP 响应体。
 */
const registry = require('../core/registry');

/** 执行一个 job，返回响应体 */
function handle(kind, input) {
  const result = registry.dispatch(kind, input);
  return { status: 200, body: result };
}

/** 执行失败时的错误响应 */
function fail(kind, e) {
  return { status: 500, body: { kind, error: String(e && e.message ? e.message : e) } };
}

module.exports = { handle, fail };
`,
  },
  {
    rel: 'src/adapters/queue.js',
    content: `/**
 * 队列适配层 —— 把待办 job 排进队列。
 *
 * ⚠️ 沙箱里没有真正的消息队列，这里用一个内存数组模拟。
 */
const pending = [];

/** 入队 */
function enqueue(kind, payload) {
  pending.push({ kind, payload, at: Date.now() });
  return pending.length;
}

/** 出队（先进先出） */
function dequeue() {
  return pending.shift() || null;
}

/** 队列长度 */
function size() {
  return pending.length;
}

module.exports = { enqueue, dequeue, size };
`,
  },
  {
    rel: 'src/adapters/storage.js',
    content: `/**
 * 存储适配层 —— 一个内存 KV，用来放 job 的中间产物。
 */
const store = new Map();

/** 写 */
function put(key, value) {
  store.set(key, value);
  return value;
}

/** 读 */
function get(key) {
  return store.get(key);
}

/** 删 */
function del(key) {
  return store.delete(key);
}

/** 按前缀扫描 */
function scan(prefix) {
  const out = [];
  for (const [k, v] of store) {
    if (k.startsWith(prefix)) out.push([k, v]);
  }
  return out;
}

module.exports = { put, get, del, scan };
`,
  },
  {
    rel: 'src/adapters/logger.js',
    content: `/**
 * 日志适配层 —— 把 job 执行的来龙去脉记下来。
 */
const logger = require('../core/logger');

/** 记录一次执行 */
function trace(scope, kind, input) {
  logger.debug(scope, 'run ' + kind + ' ' + JSON.stringify(input));
}

/** 记录一次失败 */
function failure(scope, kind, e) {
  logger.error(scope, 'fail ' + kind + ': ' + (e && e.message ? e.message : e));
}

module.exports = { trace, failure };
`,
  },
  {
    rel: 'src/adapters/metrics.js',
    content: `/**
 * 指标适配层 —— 统计每个 kind 跑了多少次、成了多少次。
 */
const metrics = require('../core/metrics');

/** 记录一次成功 */
function success(kind) {
  metrics.increment('job.ok.' + kind);
}

/** 记录一次失败 */
function failure(kind) {
  metrics.increment('job.fail.' + kind);
}

/** 读取全部指标 */
function all() {
  return metrics.snapshot();
}

module.exports = { success, failure, all };
`,
  },
  {
    rel: 'src/adapters/retry.js',
    content: `/**
 * 重试适配层 —— 在 job 外面包一层重试。
 */
const { withRetry } = require('../core/retry');
const registry = require('../core/registry');

/** 带重试地执行一个 job */
function run(kind, input, retries) {
  return withRetry(() => registry.dispatch(kind, input), retries);
}

module.exports = { run };
`,
  },
  {
    rel: 'src/adapters/clock.js',
    content: `/**
 * 时钟适配层 —— 让 job 用"可注入的现在"，
 * 这样测试可以固定时间，不用真的等。
 */
let offset = 0;

/** 让时钟往前拨多少毫秒 */
function advance(ms) {
  offset += ms;
  return offset;
}

/** 重置时钟 */
function reset() {
  offset = 0;
}

/** 当前时间 */
function now() {
  return Date.now() + offset;
}

module.exports = { advance, reset, now };
`,
  },
  {
    rel: 'src/adapters/random.js',
    content: `/**
 * 随机数适配层 —— 可注入种子，保证评测可复现。
 */
let seed = 42;

/** 设置种子 */
function setSeed(value) {
  seed = value >>> 0;
}

/**
 * 生成 [0, 1) 的伪随机数（线性同余）。
 *
 * ⚠️ 不用 Math.random()：评测要能复现，
 *    同样的输入必须得到同样的输出。
 */
function next() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

/** [min, max] 之间的整数 */
function int(min, max) {
  return min + Math.floor(next() * (max - min + 1));
}

module.exports = { setSeed, next, int };
`,
  },
];

/** 流程编排 —— 真实存在的噪声代码 */
const PIPELINE_FILES = [
  {
    rel: 'src/pipeline/nightly.js',
    content: `/**
 * 夜间结算流程。
 */
const registry = require('../core/registry');

/** 跑一遍夜间流程 */
function runNightly(input) {
  const steps = [];
  steps.push(registry.dispatch('billing.invoice', input));
  steps.push(registry.dispatch('billing.tax', input));
  steps.push(registry.dispatch('shipping.rate', input));
  steps.push(registry.dispatch('inventory.stock', input));
  return { steps };
}

module.exports = { runNightly };
`,
  },
  {
    rel: 'src/pipeline/onboarding.js',
    content: `/**
 * 新用户接入流程。
 */
const registry = require('../core/registry');

/** 跑一遍接入流程 */
function runOnboarding(input) {
  const steps = [];
  steps.push(registry.dispatch('billing.subscription', input));
  steps.push(registry.dispatch('notify.preference', input));
  steps.push(registry.dispatch('inventory.audit', input));
  return { steps };
}

module.exports = { runOnboarding };
`,
  },
  {
    rel: 'src/pipeline/settlement.js',
    content: `/**
 * 结算流程。
 */
const registry = require('../core/registry');

/** 跑一遍结算流程 */
function runSettlement(input) {
  const steps = [];
  steps.push(registry.dispatch('billing.payout', input));
  steps.push(registry.dispatch('billing.dunning', input));
  steps.push(registry.dispatch('inventory.shrink', input));
  return { steps };
}

module.exports = { runSettlement };
`,
  },
  {
    rel: 'src/pipeline/refund.js',
    content: `/**
 * 退款流程。
 */
const registry = require('../core/registry');

/** 跑一遍退款流程 */
function runRefund(input) {
  const steps = [];
  steps.push(registry.dispatch('billing.refund', input));
  steps.push(registry.dispatch('shipping.return', input));
  steps.push(registry.dispatch('notify.email', input));
  return { steps };
}

module.exports = { runRefund };
`,
  },
  {
    rel: 'src/pipeline/inventory-sync.js',
    content: `/**
 * 库存同步流程。
 */
const registry = require('../core/registry');

/** 跑一遍库存同步 */
function runSync(input) {
  const steps = [];
  steps.push(registry.dispatch('inventory.reorder', input));
  steps.push(registry.dispatch('inventory.transfer', input));
  return { steps };
}

module.exports = { runSync };
`,
  },
  {
    rel: 'src/pipeline/dispatch.js',
    content: `/**
 * 配送下发流程。
 */
const registry = require('../core/registry');

/** 跑一遍配送下发 */
function runDispatch(input) {
  const steps = [];
  steps.push(registry.dispatch('shipping.label', input));
  steps.push(registry.dispatch('shipping.dispatch', input));
  steps.push(registry.dispatch('shipping.track', input));
  return { steps };
}

module.exports = { runDispatch };
`,
  },
  {
    rel: 'src/pipeline/notify.js',
    content: `/**
 * 通知群发流程。
 */
const registry = require('../core/registry');

/** 跑一遍通知群发 */
function runNotify(input) {
  const steps = [];
  steps.push(registry.dispatch('notify.sms', input));
  steps.push(registry.dispatch('notify.push', input));
  steps.push(registry.dispatch('notify.webhook', input));
  return { steps };
}

module.exports = { runNotify };
`,
  },
  {
    rel: 'src/pipeline/reports.js',
    content: `/**
 * 报表流程。
 */
const registry = require('../core/registry');

/** 跑一遍报表 */
function runReport(input) {
  const steps = [];
  steps.push(registry.dispatch('notify.digest', input));
  steps.push(registry.dispatch('inventory.audit', input));
  return { steps };
}

module.exports = { runReport };
`,
  },
];

/** 小工具 —— 真实存在的噪声代码 */
const UTIL_FILES = [
  {
    rel: 'src/util/money.js',
    content: `/**
 * 金额工具 —— 全部按【分】算，避免浮点误差。
 */

/** 元转分 */
function toCents(yuan) {
  return Math.round(Number(yuan) * 100) || 0;
}

/** 分转元 */
function toYuan(cents) {
  return (Number(cents) || 0) / 100;
}

/** 格式化成两位小数的字符串 */
function format(cents) {
  return (Number(cents) || 0).toFixed(2);
}

/** 相加 */
function add(a, b) {
  return (Number(a) || 0) + (Number(b) || 0);
}

module.exports = { toCents, toYuan, format, add };
`,
  },
  {
    rel: 'src/util/date.js',
    content: `/**
 * 日期工具。
 */

/** 今天的 YYYY-MM-DD */
function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/** 加天数 */
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 两个日期差几天 */
function diffDays(a, b) {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((da - db) / 86400000);
}

module.exports = { today, addDays, diffDays };
`,
  },
  {
    rel: 'src/util/text.js',
    content: `/**
 * 文本工具。
 */

/** 首字母大写 */
function capitalize(s) {
  const t = String(s == null ? '' : s);
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** 截断到指定长度（按字符） */
function clip(s, max) {
  const t = String(s == null ? '' : s);
  return t.length > max ? t.slice(0, max) : t;
}

/** 统计非空白字符数 */
function countNonSpace(s) {
  return String(s == null ? '' : s).replace(/\\s/g, '').length;
}

/** slug 化 */
function slug(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { capitalize, clip, countNonSpace, slug };
`,
  },
  {
    rel: 'src/util/assert.js',
    content: `/**
 * 断言工具 —— 出错时把两边都打出来，省得调半天。
 */

/** 断言条件成立 */
function ok(cond, message) {
  if (!cond) throw new Error(message || '断言失败');
}

/** 断言两个值相等 */
function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      (message || '值不相等') + '：实际=' + JSON.stringify(actual) + ' 期望=' + JSON.stringify(expected),
    );
  }
}

/** 断言是函数 */
function fn(value, message) {
  ok(typeof value === 'function', message || '期望是函数，实际是 ' + typeof value);
}

module.exports = { ok, equal, fn };
`,
  },
  {
    rel: 'src/util/result.js',
    content: `/**
 * 结果对象小工具。
 */

/** 成功结果 */
function success(value) {
  return { ok: true, value };
}

/** 失败结果 */
function failure(error) {
  return { ok: false, error: String(error) };
}

/** 取值，失败时给默认值 */
function unwrap(result, fallback) {
  if (!result || !result.ok) return fallback;
  return result.value;
}

module.exports = { success, failure, unwrap };
`,
  },
  {
    rel: 'src/util/lazy.js',
    content: `/**
 * 惰性求值 —— 第一次访问才真正算。
 */

/** 造一个惰性值 */
function lazy(factory) {
  let called = false;
  let value;
  return {
    get() {
      if (!called) {
        called = true;
        value = factory();
      }
      return value;
    },
    get called() {
      return called;
    },
  };
}

/** 记忆化：同一个 key 只算一次 */
function memoize(fn) {
  const cache = new Map();
  return function memoized(key) {
    if (cache.has(key)) return cache.get(key);
    const value = fn(key);
    cache.set(key, value);
    return value;
  };
}

module.exports = { lazy, memoize };
`,
  },
  {
    rel: 'src/util/chunk.js',
    content: `/**
 * 数组分块工具。
 */

/** 按 size 分块 */
function chunk(list, size) {
  const out = [];
  const s = size > 0 ? size : 1;
  for (let i = 0; i < list.length; i += s) out.push(list.slice(i, i + s));
  return out;
}

/** 按 key 分组 */
function groupBy(list, keyOf) {
  const out = new Map();
  for (const item of list) {
    const key = keyOf(item);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}

/** 去重（保留首次出现的顺序） */
function unique(list) {
  return Array.from(new Set(list));
}

module.exports = { chunk, groupBy, unique };
`,
  },
  {
    rel: 'src/util/env.js',
    content: `/**
 * 环境变量读取 —— 沙箱里没有 .env，所以全部有默认值。
 */

/** 读字符串 */
function str(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

/** 读数字 */
function num(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

/** 读布尔 */
function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

module.exports = { str, num, bool };
`,
  },
];

/** 入口与说明 */
const ROOT_FILES = [
  {
    rel: 'index.js',
    content: `#!/usr/bin/env node
/**
 * job-runner 的命令行入口。
 *
 * 用法：
 *   node index.js --list-kinds     列出当前注册的所有 job kind
 *   node index.js --run <kind>     用默认输入跑一个 job
 *
 * ⚠️ --list-kinds 反映的是【运行期】注册表里的内容，
 *    跟"grep 能搜到多少个 kind"不一定对得上 ——
 *    有些实现是在被加载的时候才登记自己的。
 */
const loader = require('./src/core/loader');
const registry = require('./src/core/registry');

/** 加载全部实现并返回注册表 */
function boot() {
  loader.loadAll();
  return registry;
}

function main(argv) {
  const arg = argv[2];

  if (arg === '--list-kinds') {
    boot();
    console.log(registry.kinds().join('\\n'));
    return 0;
  }

  if (arg === '--run') {
    boot();
    const kind = argv[3];
    if (!kind) {
      console.error('用法：node index.js --run <kind>');
      return 1;
    }
    const result = registry.dispatch(kind, { amount: 12345, label: 'demo', count: 3 });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.log('用法：node index.js --list-kinds | --run <kind>');
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { boot, main };
`,
  },
  {
    rel: 'README.md',
    content: `# job-runner

一个"跑任务"的极简执行器：注册一堆 job kind，按 kind 分发执行。

\`\`\`bash
node index.js --list-kinds     # 列出当前注册的所有 job kind
node index.js --run <kind>     # 用默认输入跑一个 job
\`\`\`

## 目录结构

| 目录 | 放什么 |
|---|---|
| \`src/core/\` | 执行器内核：注册表、加载器、结果契约 |
| \`src/handlers/\` | 内置 job 实现，按业务域分子目录 |
| \`src/adapters/\` | 外部系统适配层 |
| \`src/pipeline/\` | 组合多个 job 的流程编排 |
| \`src/util/\` | 无状态的小工具 |

## 结果契约

\`src/core/contract.js\` 定义了所有 job 的返回约定：

\`\`\`js
const { ok, fail } = require('./src/core/contract');

function run(input) {
  if (!input) return fail('缺少 input');
  return ok({ total: 42 });
}
\`\`\`

调用方（pipeline / adapters）只认这一种形状。
`,
  },
];

module.exports = {
  TASK_ID,
  /** 冒烟测试用：生成的代码必须能被 node 加载 */
  smoke: 'index.js',
  generate(taskDir) {
    const initialDir = path.join(taskDir, 'initial');
    resetDir(initialDir);

    const files = [];
    files.push(...ROOT_FILES);
    files.push(...CORE_FILES);

    // 内置 handler
    files.push({
      rel: 'src/handlers/index.js',
      content: `/**
 * 内置 handler 的汇总入口。
 *
 * 这里的 require 有两个作用：
 *   1. 让各组 handler 文件被加载（自注册就是这么发生的）
 *   2. 把它们汇总起来，方便加载器统一校验
 */
const billing = require('./billing');
const inventory = require('./inventory');
const shipping = require('./shipping');
const notify = require('./notify');

module.exports = {
  handlers: [...billing, ...inventory, ...shipping, ...notify],
};
`,
    });
    for (const group of CORE_GROUPS) {
      files.push(groupIndexFile(group));
      for (const h of group.handlers) files.push(coreHandlerFile(group, h));
    }

    // 扩展插件
    for (const p of PLUGINS) files.push(pluginFile(p));

    files.push(...ADAPTER_FILES);
    files.push(...PIPELINE_FILES);
    files.push(...UTIL_FILES);

    writeTree(initialDir, files);
    return statsOf(initialDir);
  },
};
