/**
 * 42-hard-scale-reexport 的初始代码生成器
 *
 * ⭐ 这道题考什么：
 *
 *   "改一个函数，所有调用点都要跟着改" —— 听起来简单，
 *   直到你发现这个函数在一个【三层转发链】后面，而且每一层都可能覆盖它。
 *
 *   对外入口只有 4 个，但它们的来源链各不相同：
 *
 *     api/index.js → public/index.js → internal/index.js → core/string.js   ✅ 正确
 *     api/http.js  → public/http.js  → internal/http.js  → core/string.js   ❌ 被覆盖
 *     api/cli.js   → public/cli.js   → internal/index.js → core/string.js   ❌ 被覆盖
 *     api/feed.js  → public/feed.js  → internal/index.js → core/string.js   ❌ 被覆盖
 *
 *   ⭐ 真正的陷阱不是"找不到 truncate"，而是【改错地方】：
 *
 *     · 直接改 core/string.js → 对 3 个坏入口【一点用都没有】（它们被覆盖了）
 *     · 直接改 core/legacy.js → 3 个入口全好了，但内部日志/预览链路的行为也变了
 *       （那三个链路依赖旧的字节级语义）→ 触发回归
 *
 *   所以正解是【在最外层重新声明】正确的 truncate，同时不动内层被依赖的旧行为。
 *
 * ⚠️ 规模：60+ 文件、8 个目录，每个转发文件都是几十行的显式符号清单，
 *   不通读、不顺着 import 链走，就不可能知道真正生效的是哪一份。
 */

const path = require('path');
const { writeTree, resetDir, statsOf } = require('./lib');

const TASK_ID = '42-hard-scale-reexport';

/**
 * 造一个"显式转发"的转发文件。
 *
 * ⚠️ 显式列出每一个对外符号，而不是把整个模块 require 出去 ——
 *   一是避免内部实现意外泄漏成公开 API，
 *   二是这份清单本身就是"这一层到底对外承诺了什么"的文档。
 *
 * @param {Array<{var:string, from:string, symbols:string[]}>} spec
 * @param {string} note 文件头说明
 * @param {string} [extra] 额外追加的导出（比如覆盖某个符号）
 */
function makeBarrel(spec, note, extra) {
  const requires = spec.map((s) => `const ${s.var} = require('${s.from}');`);
  const props = [];
  for (const s of spec) {
    for (const sym of s.symbols) props.push(`  ${sym}: ${s.var}.${sym},`);
  }
  return `/**
 * ${note}
 *
 * ⚠️ 显式列出对外暴露的符号，而不是整个 require 出去 ——
 *    免得内部实现不小心就泄漏成公开 API。
 */
${requires.join('\n')}

module.exports = {
${props.join('\n')}${extra ? '\n' + extra : ''}
};
`;
}

/**
 * 把 "xxx.js" 转成合法的变量名。
 *
 * ⚠️ 必须加前缀：CommonJS 的模块包装函数里已经有 exports / require / module
 *   这几个形参了，`const exports = require('./exports')` 会直接语法报错。
 */
function varOf(file) {
  return 'm_' + file.replace(/\.js$/, '').replace(/[^a-zA-Z0-9]/g, '_');
}

/** core 层每个模块导出的符号 */
const CORE_MODULES = {
  'string.js': ['truncate', 'padStart', 'slugify', 'capitalize', 'trim', 'repeat'],
  'number.js': ['formatBytes', 'clamp', 'parseRange', 'roundTo', 'isInteger', 'toPercent'],
  'date.js': ['formatDate', 'parseDate', 'addDays', 'diffDays', 'startOfDay'],
  'array.js': ['chunk', 'groupBy', 'unique', 'flatten', 'first', 'last'],
  'object.js': ['pick', 'omit', 'deepMerge', 'get', 'has'],
  'text.js': ['truncateWords', 'wordCount', 'similarity', 'normalizeSpace', 'levenshtein'],
  'path.js': ['joinPath', 'extname', 'basename', 'dirname'],
  'hash.js': ['simpleHash', 'stableStringify'],
  'json.js': ['safeParse', 'safeStringify'],
  'color.js': ['hexToRgb', 'rgbToHex'],
  'url.js': ['parseQuery', 'buildQuery'],
  'regex.js': ['escapeRegExp', 'matchAll'],
  'legacy.js': ['legacyTruncate', 'legacyPadStart'],
};

/** internal 层自己的模块 */
const INTERNAL_MODULES = {
  'paths.js': ['routeOf', 'joinRoute'],
  'cache.js': ['cacheGet', 'cacheSet', 'cacheClear'],
  'lock.js': ['withLock'],
  'validate.js': ['validatePayload'],
  'paginate.js': ['paginate'],
  'serialize.js': ['serialize'],
  'errors.js': ['describeError'],
  'feature.js': ['featureFlags', 'enableFeature'],
};

/** public 层自己的模块 */
const PUBLIC_MODULES = {
  'exports.js': ['publicVersion', 'describeExports'],
  'openapi.js': ['openApiSpec'],
  'permissions.js': ['can'],
  'ratelimit.js': ['rateLimitKey'],
  'webhooks.js': ['signPayload'],
  'analytics.js': ['trackEvent', 'readEvents'],
};

/** api 层自己的模块 */
const API_MODULES = {
  'meta.js': ['apiVersion', 'describeApi', 'healthcheck'],
  'admin.js': ['adminOverview'],
  'webhook.js': ['verifyWebhook'],
  'reports.js': ['reportMeta'],
  'events.js': ['emit', 'list'],
};

/** core 层各模块的正文 */
const CORE_FILES = {
  'string.js': `/**
 * 字符串工具 —— 仓库里【唯一】一份按【字符】截断的实现。
 *
 * ⚠️ 这里的 truncate 是对外 API 的正确语义：
 *    按字符（不是字节）截断，超长时补一个省略号。
 */
function truncate(text, max) {
  const s = String(text == null ? '' : text);
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

/** 左侧补齐 */
function padStart(text, width, fill) {
  const s = String(text == null ? '' : text);
  const f = fill === undefined ? ' ' : String(fill);
  let out = s;
  while (out.length < width) out = f + out;
  return out;
}

/** slug 化 */
function slugify(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 首字母大写 */
function capitalize(text) {
  const s = String(text == null ? '' : text);
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** 去首尾空白 */
function trim(text) {
  return String(text == null ? '' : text).trim();
}

/** 重复字符串 */
function repeat(text, times) {
  return String(text == null ? '' : text).repeat(Math.max(0, times | 0));
}

module.exports = { truncate, padStart, slugify, capitalize, trim, repeat };
`,
  'legacy.js': `/**
 * 旧版字符串工具 —— 按【字节】处理。
 *
 * ⚠️ 这份实现只服务两类老链路：
 *   1. 日志摘要（要把一整行日志压到固定宽度）
 *   2. 老版本的 HTTP 预览接口
 *
 *   它对多字节字符会切出半个字（显示成乱码），但老链路一直在用，
 *   所以这个行为是被下游依赖着的。
 */
function legacyTruncate(text, max) {
  const buf = Buffer.from(String(text == null ? '' : text), 'utf-8');
  if (buf.length <= max) return buf.toString('utf-8');
  return buf.slice(0, max).toString('utf-8') + '...';
}

/** 旧版左补齐（按字节算宽度） */
function legacyPadStart(text, width) {
  const buf = Buffer.from(String(text == null ? '' : text), 'utf-8');
  if (buf.length >= width) return buf.toString('utf-8');
  return ' '.repeat(width - buf.length) + buf.toString('utf-8');
}

module.exports = { legacyTruncate, legacyPadStart };
`,
  'number.js': `/**
 * 数字工具。
 */

/** 人类可读的字节数 */
function formatBytes(bytes, digits) {
  const n = Number(bytes) || 0;
  const d = digits === undefined ? 1 : digits;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.abs(n);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value = value / 1024;
    i += 1;
  }
  return (n < 0 ? '-' : '') + value.toFixed(d) + ' ' + units[i];
}

/** 把数字夹在 [min, max] 之间 */
function clamp(n, min, max) {
  const v = Number(n) || 0;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * 解析 "1-10" 这种区间写法。
 *
 * @returns {number[]} 两个数字；解析不出来返回空数组
 */
function parseRange(spec) {
  const m = /^(\\d+)\\s*-\\s*(\\d+)$/.exec(String(spec || '').trim());
  if (!m) return [];
  return [Number(m[1]), Number(m[2])];
}

/** 四舍五入到指定小数位 */
function roundTo(n, digits) {
  const f = Math.pow(10, digits === undefined ? 2 : digits);
  return Math.round((Number(n) || 0) * f) / f;
}

/** 是不是整数 */
function isInteger(n) {
  return Number.isInteger(Number(n));
}

/** 转百分比字符串 */
function toPercent(n, digits) {
  return roundTo((Number(n) || 0) * 100, digits === undefined ? 1 : digits) + '%';
}

module.exports = { formatBytes, clamp, parseRange, roundTo, isInteger, toPercent };
`,
  'date.js': `/**
 * 日期工具 —— 全部走 UTC，避免在不同的机器上算出不同的结果。
 */

/** 格式化成 YYYY-MM-DD */
function formatDate(ts) {
  const d = new Date(ts === undefined ? Date.now() : ts);
  return d.toISOString().slice(0, 10);
}

/** 解析 YYYY-MM-DD，解析不出来返回 null */
function parseDate(s) {
  const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  return new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00Z').getTime();
}

/** 加天数 */
function addDays(dateStr, days) {
  const ts = parseDate(dateStr);
  if (ts === null) return null;
  const d = new Date(ts);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 相差几天 */
function diffDays(a, b) {
  const ta = parseDate(a);
  const tb = parseDate(b);
  if (ta === null || tb === null) return 0;
  return Math.round((ta - tb) / 86400000);
}

/** 当天起点的时间戳 */
function startOfDay(ts) {
  const d = new Date(ts === undefined ? Date.now() : ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

module.exports = { formatDate, parseDate, addDays, diffDays, startOfDay };
`,
  'array.js': `/**
 * 数组工具。
 */

/** 分块 */
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

/** 去重，保留首次出现的顺序 */
function unique(list) {
  return Array.from(new Set(list));
}

/** 摊平一层 */
function flatten(list) {
  const out = [];
  for (const item of list) {
    if (Array.isArray(item)) out.push(...item);
    else out.push(item);
  }
  return out;
}

/** 第一个元素 */
function first(list) {
  return list && list.length ? list[0] : undefined;
}

/** 最后一个元素 */
function last(list) {
  return list && list.length ? list[list.length - 1] : undefined;
}

module.exports = { chunk, groupBy, unique, flatten, first, last };
`,
  'object.js': `/**
 * 对象工具。
 */

/** 只取指定的几个 key */
function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}

/** 去掉指定的几个 key */
function omit(obj, keys) {
  const out = {};
  for (const k of Object.keys(obj || {})) {
    if (!keys.includes(k)) out[k] = obj[k];
  }
  return out;
}

/** 深合并（后者覆盖前者） */
function deepMerge(a, b) {
  const out = Object.assign({}, a || {});
  for (const k of Object.keys(b || {})) {
    const av = out[k];
    const bv = b[k];
    if (av && bv && typeof av === 'object' && typeof bv === 'object' && !Array.isArray(av) && !Array.isArray(bv)) {
      out[k] = deepMerge(av, bv);
    } else {
      out[k] = bv;
    }
  }
  return out;
}

/** 按路径取值 */
function get(obj, path, fallback) {
  const parts = String(path || '').split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return fallback;
    cur = cur[p];
  }
  return cur === undefined ? fallback : cur;
}

/** 对象上有没有这个路径 */
function has(obj, path) {
  const sentinel = {};
  return get(obj, path, sentinel) !== sentinel;
}

module.exports = { pick, omit, deepMerge, get, has };
`,
  'text.js': `/**
 * 文本统计工具。
 */

/** 按单词截断 */
function truncateWords(text, maxWords) {
  const words = String(text == null ? '' : text).split(/\\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ') + '…';
}

/** 词数 */
function wordCount(text) {
  return String(text == null ? '' : text).split(/\\s+/).filter(Boolean).length;
}

/** 两个字符串的相似度（0~1） */
function similarity(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  if (x === y) return 1;
  if (!x.length || !y.length) return 0;
  const d = levenshtein(x, y);
  return 1 - d / Math.max(x.length, y.length);
}

/** 压缩连续空白 */
function normalizeSpace(text) {
  return String(text == null ? '' : text).replace(/\\s+/g, ' ').trim();
}

/** 编辑距离 */
function levenshtein(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  const prev = new Array(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (x[i - 1] === y[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[y.length];
}

module.exports = { truncateWords, wordCount, similarity, normalizeSpace, levenshtein };
`,
  'path.js': `/**
 * 路径工具（只处理 POSIX 风格的相对路径，跟平台无关）。
 */

/** 拼接路径 */
function joinPath(...parts) {
  return parts
    .filter((p) => p !== undefined && p !== null && p !== '')
    .join('/')
    .replace(/\\/+/g, '/')
    .replace(/^\\.\\//, '');
}

/** 扩展名（含点） */
function extname(p) {
  const s = String(p || '');
  const base = s.slice(s.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i);
}

/** 文件名 */
function basename(p) {
  const s = String(p || '');
  return s.slice(s.lastIndexOf('/') + 1);
}

/** 目录名 */
function dirname(p) {
  const s = String(p || '');
  const i = s.lastIndexOf('/');
  return i <= 0 ? '' : s.slice(0, i);
}

module.exports = { joinPath, extname, basename, dirname };
`,
  'hash.js': `/**
 * 哈希工具。
 *
 * ⚠️ 这里用的是简单哈希，不是密码学哈希 ——
 *   用途是"快速判断两段内容是不是一样"，不是防篡改。
 */

/** 简单字符串哈希（djb2 变体） */
function simpleHash(s) {
  const str = String(s == null ? '' : s);
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 稳定序列化 —— 对象的 key 排序后再输出。
 *
 * ⚠️ 排序是必须的：不然同样内容的两个对象序列化结果可能不一样，
 *   拿它做哈希/比对会得出错误结论。
 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

module.exports = { simpleHash, stableStringify };
`,
  'json.js': `/**
 * JSON 工具 —— 全部不抛异常，解析不了就给默认值。
 */

/** 安全解析 */
function safeParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback === undefined ? null : fallback;
  }
}

/** 安全序列化 */
function safeStringify(value, fallback) {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback === undefined ? null : fallback;
  }
}

module.exports = { safeParse, safeStringify };
`,
  'color.js': `/**
 * 颜色工具。
 */

/** #rrggbb → { r, g, b } */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** { r, g, b } → #rrggbb */
function rgbToHex(rgb) {
  if (!rgb) return '#000000';
  const part = (v) => Math.max(0, Math.min(255, Number(v) || 0)).toString(16).padStart(2, '0');
  return '#' + part(rgb.r) + part(rgb.g) + part(rgb.b);
}

module.exports = { hexToRgb, rgbToHex };
`,
  'url.js': `/**
 * URL 工具。
 */

/** 解析查询串 */
function parseQuery(query) {
  const out = {};
  const q = String(query || '').replace(/^\\?/, '');
  for (const pair of q.split('&')) {
    if (!pair) continue;
    const i = pair.indexOf('=');
    const k = decodeURIComponent(i === -1 ? pair : pair.slice(0, i));
    const v = i === -1 ? '' : decodeURIComponent(pair.slice(i + 1));
    out[k] = v;
  }
  return out;
}

/** 拼查询串 */
function buildQuery(obj) {
  const parts = [];
  for (const k of Object.keys(obj || {})) {
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
  }
  return parts.join('&');
}

module.exports = { parseQuery, buildQuery };
`,
  'regex.js': `/**
 * 正则工具。
 */

/** 转义正则元字符 */
function escapeRegExp(s) {
  return String(s == null ? '' : s).replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
}

/**
 * 找出所有匹配（返回数组，不带 lastIndex 状态）。
 *
 * ⚠️ 不用带 /g 的全局正则做 exec 循环 ——
 *   全局正则有 lastIndex 状态，复用同一个正则对象会让第二次调用结果为空。
 *   这里每次都新建正则，牺牲一点性能换掉一整类难查的 bug。
 */
function matchAll(text, pattern) {
  const re = new RegExp(pattern, 'g');
  const out = [];
  const s = String(text == null ? '' : text);
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push(m[0]);
    if (m[0] === '') re.lastIndex += 1;
  }
  return out;
}

module.exports = { escapeRegExp, matchAll };
`,
};

/** internal 层自己的模块 */
const INTERNAL_FILES = {
  'paths.js': `/**
 * 路由辅助。
 */

/** 从 "/a/b/c" 里取出 "c" */
function routeOf(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/** 拼一个路由 */
function joinRoute(...parts) {
  return '/' + parts.filter(Boolean).join('/');
}

module.exports = { routeOf, joinRoute };
`,
  'cache.js': `/**
 * 进程内缓存。
 *
 * ⚠️ 没有 TTL —— 这层缓存只活在一个请求的生命周期里。
 */
const store = new Map();

/** 读 */
function cacheGet(key) {
  return store.get(key);
}

/** 写 */
function cacheSet(key, value) {
  store.set(key, value);
  return value;
}

/** 清空 */
function cacheClear() {
  store.clear();
}

module.exports = { cacheGet, cacheSet, cacheClear };
`,
  'lock.js': `/**
 * 简单的互斥锁（同一把锁的第二个持有者会被拒绝）。
 */
const locks = new Set();

/** 尝试加锁 */
function withLock(key, fn) {
  if (locks.has(key)) throw new Error('lock busy: ' + key);
  locks.add(key);
  try {
    return fn();
  } finally {
    locks.delete(key);
  }
}

module.exports = { withLock };
`,
  'validate.js': `/**
 * 载荷校验。
 */

/**
 * 校验一个对象必填字段。
 *
 * @returns {string[]} 缺失的字段名，空数组表示通过
 */
function validatePayload(payload, required) {
  const missing = [];
  for (const field of required || []) {
    if (!payload || payload[field] === undefined || payload[field] === null) missing.push(field);
  }
  return missing;
}

module.exports = { validatePayload };
`,
  'paginate.js': `/**
 * 分页。
 */

/**
 * 把一个列表切成一页。
 *
 * @returns {{ items: any[], page: number, pages: number, total: number }}
 */
function paginate(list, page, size) {
  const items = list || [];
  const s = size > 0 ? size : 20;
  const pages = Math.max(1, Math.ceil(items.length / s));
  const p = Math.min(Math.max(1, page || 1), pages);
  return { items: items.slice((p - 1) * s, p * s), page: p, pages, total: items.length };
}

module.exports = { paginate };
`,
  'serialize.js': `/**
 * 序列化 —— 把内部结构转成对外的 JSON 形状。
 */

/** 把 record 转成对外形状 */
function serialize(record) {
  if (!record) return null;
  return { id: record.id, title: record.title, at: record.at };
}

module.exports = { serialize };
`,
  'errors.js': `/**
 * 错误描述。
 */

/** 把任意错误转成对外可读的结构 */
function describeError(e) {
  if (!e) return { message: 'unknown error' };
  return { name: e.name || 'Error', message: String(e.message || e) };
}

module.exports = { describeError };
`,
  'feature.js': `/**
 * 特性开关。
 */
const flags = new Set(['export-v2']);

/** 是否开启 */
function featureFlags(name) {
  return flags.has(name);
}

/** 打开开关 */
function enableFeature(name) {
  flags.add(name);
}

module.exports = { featureFlags, enableFeature };
`,
};

/** public 层自己的模块 */
const PUBLIC_FILES = {
  'exports.js': `/**
 * 对外导出清单的自我描述。
 */

/** 当前公开 API 的版本号 */
function publicVersion() {
  return '2.4.0';
}

/** 列出所有对外符号 */
function describeExports() {
  const mod = require('./index');
  return Object.keys(mod).sort();
}

module.exports = { publicVersion, describeExports };
`,
  'openapi.js': `/**
 * OpenAPI 描述（手写的一小段，够前端联调就行）。
 */

/** 生成一份最小的 spec */
function openApiSpec(title) {
  return {
    openapi: '3.0.0',
    info: { title: title || 'Internal API', version: '2.4.0' },
    paths: {},
  };
}

module.exports = { openApiSpec };
`,
  'permissions.js': `/**
 * 权限判断。
 */

/**
 * 判断当前主体能不能做某个动作。
 *
 * @param {string[]} grants 主体拥有的权限
 * @param {string}   action  要做的动作
 */
function can(grants, action) {
  return (grants || []).includes(action);
}

module.exports = { can };
`,
  'ratelimit.js': `/**
 * 限流键的计算。
 */

/** 按 用户 + 路径 生成限流键 */
function rateLimitKey(subject, pathname) {
  return String(subject || 'anon') + '|' + String(pathname || '/');
}

module.exports = { rateLimitKey };
`,
  'webhooks.js': `/**
 * Webhook 签名。
 */
const { simpleHash } = require('../core/hash');

/** 给载荷签名 */
function signPayload(payload, secret) {
  return simpleHash(JSON.stringify(payload || {}) + '|' + String(secret || ''));
}

module.exports = { signPayload };
`,
  'analytics.js': `/**
 * 埋点。
 */

/** 记一条埋点（内存里，进程结束就没了） */
const events = [];
function trackEvent(name, props) {
  events.push({ name, props: props || {}, at: Date.now() });
  return events.length;
}

/** 读埋点 */
function readEvents() {
  return events.slice();
}

module.exports = { trackEvent, readEvents };
`,
};

/** api 层自己的模块 */
const API_FILES = {
  'meta.js': `/**
 * API 元信息。
 */

/** 当前 API 版本 */
function apiVersion() {
  return '2.4.0';
}

/** 描述这份 API */
function describeApi() {
  return { version: apiVersion(), at: Date.now() };
}

/** 健康检查 */
function healthcheck() {
  return { ok: true };
}

module.exports = { apiVersion, describeApi, healthcheck };
`,
  'admin.js': `/**
 * 管理端接口。
 */
const pub = require('../public');

/** 管理端概览 */
function adminOverview() {
  return { version: pub.publicVersion(), exports: pub.describeExports().length };
}

module.exports = { adminOverview };
`,
  'webhook.js': `/**
 * Webhook 接收端。
 */
const { signPayload } = require('../public/webhooks');

/** 校验签名 */
function verifyWebhook(payload, secret) {
  return signPayload(payload, secret);
}

module.exports = { verifyWebhook };
`,
  'reports.js': `/**
 * 报表接口。
 */
const { formatDate } = require('../core/date');

/** 生成一份日报的元信息 */
function reportMeta(day) {
  return { day: formatDate(day), generatedAt: Date.now() };
}

module.exports = { reportMeta };
`,
  'events.js': `/**
 * 事件接口。
 */
const { trackEvent, readEvents } = require('../public/analytics');

/** 上报 */
function emit(name, props) {
  return trackEvent(name, props);
}

/** 查询 */
function list() {
  return readEvents();
}

module.exports = { emit, list };
`,
};

/** 消费方模块（features / widgets / utils） */
const FEATURE_FILES = {
  'httpPreview.js': `/**
 * HTTP 预览 —— 把响应体压成一行摘要。
 *
 * ⚠️ 这里的截断走的是内部层那一份（老的字节级语义），
 *    预览条的老样式就是这么渲染的。
 */
const { truncate } = require('../internal/http');

/** 生成一行预览 */
function preview(text, width) {
  return truncate(text, width === undefined ? 40 : width);
}

module.exports = { preview };
`,
  'logline.js': `/**
 * 日志摘要行 —— 日志中心用。
 */
const { legacyTruncate } = require('../core/legacy');

/** 生成一行日志摘要 */
function logline(text) {
  return legacyTruncate(text, 60);
}

module.exports = { logline };
`,
  'search.js': `/**
 * 站内搜索。
 */
const { normalizeSpace } = require('../core/text');

/** 搜索 */
function search(items, query) {
  const q = normalizeSpace(query).toLowerCase();
  if (!q) return [];
  return items.filter((it) => String(it.title || '').toLowerCase().indexOf(q) !== -1);
}

module.exports = { search };
`,
  'export.js': `/**
 * 导出。
 */
const { formatDate } = require('../core/date');

/** 生成导出文件名 */
function exportFileName(prefix, ts) {
  return String(prefix || 'export') + '-' + formatDate(ts) + '.csv';
}

module.exports = { exportFileName };
`,
  'profile.js': `/**
 * 个人资料页。
 */
const { slugify } = require('../core/string');

/** 生成用户的 URL slug */
function profileSlug(user) {
  return slugify((user && user.name) || 'unknown');
}

module.exports = { profileSlug };
`,
  'settings.js': `/**
 * 设置页。
 */
const { deepMerge } = require('../core/object');

/** 合并默认设置和用户设置 */
function resolveSettings(defaults, user) {
  return deepMerge(defaults, user);
}

module.exports = { resolveSettings };
`,
  'diff.js': `/**
 * 两份配置的差异。
 */
const { stableStringify } = require('../core/hash');

/** 比较两个对象（只看第一层 key） */
function diff(a, b) {
  const out = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const av = a ? a[k] : undefined;
    const bv = b ? b[k] : undefined;
    if (stableStringify(av) !== stableStringify(bv)) out.push({ key: k, from: av, to: bv });
  }
  return out;
}

module.exports = { diff };
`,
  'importer.js': `/**
 * 导入。
 */
const { safeParse } = require('../core/json');

/** 解析导入文件内容 */
function parseImport(text) {
  const parsed = safeParse(text, null);
  if (!parsed || !Array.isArray(parsed.rows)) return { ok: false, count: 0 };
  return { ok: true, count: parsed.rows.length };
}

module.exports = { parseImport };
`,
};

const WIDGET_FILES = {
  'badge.js': `/**
 * 徽标 —— 宽度有限，超出走内部层的截断。
 */
const { truncate } = require('../internal/http');

/** 渲染徽标 */
function badge(text) {
  return '[' + truncate(text, 12) + ']';
}

module.exports = { badge };
`,
  'label.js': `/**
 * 标签。
 */

/** 标签文案（截断规则跟别的模块不一样，是按词截的） */
function truncateLabel(text, maxWords) {
  const words = String(text == null ? '' : text).split(/\\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ') + '…';
}

module.exports = { truncateLabel };
`,
  'tooltip.js': `/**
 * 悬浮提示。
 */
const { escapeRegExp } = require('../core/regex');

/** 高亮关键词 */
function highlight(text, keyword) {
  if (!keyword) return String(text == null ? '' : text);
  const re = new RegExp('(' + escapeRegExp(keyword) + ')', 'gi');
  return String(text == null ? '' : text).replace(re, '<em>$1</em>');
}

module.exports = { highlight };
`,
  'avatar.js': `/**
 * 头像。
 */
const { hexToRgb, rgbToHex } = require('../core/color');

/** 由 id 派生一个稳定的颜色 */
function colorFor(id) {
  let h = 0;
  for (let i = 0; i < String(id || '').length; i++) h = (h * 31 + String(id).charCodeAt(i)) >>> 0;
  return rgbToHex({ r: h & 255, g: (h >> 8) & 255, b: (h >> 16) & 255 });
}

/** 解析颜色 */
function parseColor(hex) {
  return hexToRgb(hex);
}

module.exports = { colorFor, parseColor };
`,
  'card.js': `/**
 * 卡片。
 */
const { clamp } = require('../core/number');

/** 卡片宽度 */
function cardWidth(weight) {
  return clamp(Math.round((Number(weight) || 1) * 100), 80, 400);
}

module.exports = { cardWidth };
`,
  'tag.js': `/**
 * 标签云。
 */
const { chunk } = require('../core/array');

/** 把标签分成若干列 */
function tagColumns(tags, perColumn) {
  return chunk(tags || [], perColumn || 3);
}

module.exports = { tagColumns };
`,
};

const UTIL_FILES = {
  'string.js': `/**
 * 工具层的字符串函数。
 *
 * ⚠️ 这里的 truncate 是【日志用】的：留 3 个字符给省略号，
 *    语义跟 core 那份不一样，别搞混。
 */
function truncate(text, max) {
  const s = String(text == null ? '' : text);
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + '...';
}

/** 首字母大写 */
function capitalize(text) {
  const s = String(text == null ? '' : text);
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** 去掉前后引号 */
function unquote(text) {
  return String(text == null ? '' : text).replace(/^["']|["']$/g, '');
}

module.exports = { truncate, capitalize, unquote };
`,
  'format.js': `/**
 * 展示层格式化。
 */
const { formatBytes } = require('../core/number');

/** 文件大小 */
function fileSize(bytes) {
  return formatBytes(bytes, 2);
}

/** 百分比 */
function percent(n) {
  return (Math.round((Number(n) || 0) * 1000) / 10).toFixed(1) + '%';
}

module.exports = { fileSize, percent };
`,
  'dom.js': `/**
 * DOM 相关的字符串处理（不碰真实 DOM，纯文本）。
 */

/** 转义 HTML */
function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 属性值转义 */
function escapeAttr(text) {
  return escapeHtml(text).replace(/'/g, '&#39;');
}

module.exports = { escapeHtml, escapeAttr };
`,
  'color.js': `/**
 * 颜色工具（跟 core 的重名，但用途不同）。
 */
const { hexToRgb } = require('../core/color');

/** 判断是不是浅色背景（决定用黑字还是白字） */
function isLight(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 > 150;
}

module.exports = { isLight };
`,
  'time.js': `/**
 * 时间展示。
 */
const { formatDate } = require('../core/date');

/** 相对时间 */
function relative(ts, now) {
  const diff = (now === undefined ? Date.now() : now) - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const hours = Math.round(min / 60);
  if (hours < 24) return hours + ' 小时前';
  return formatDate(ts);
}

module.exports = { relative };
`,
  'assert.js': `/**
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
  smoke: 'index.js',
  generate(taskDir) {
    const initialDir = path.join(taskDir, 'initial');
    resetDir(initialDir);

    const files = [];
    const push = (rel, content) => files.push({ rel, content });

    // ── core 层 ──
    for (const [name, content] of Object.entries(CORE_FILES)) {
      push('src/core/' + name, content);
    }
    const coreSpec = Object.entries(CORE_MODULES).map(([file, symbols]) => ({
      var: varOf(file),
      from: './' + file.replace(/\.js$/, ''),
      symbols,
    }));
    const coreNames = coreSpec.flatMap((s) => s.symbols);
    push(
      'src/core/index.js',
      makeBarrel(coreSpec, 'core 层汇总 —— 无业务语义的通用函数。\n *\n * ⚠️ 这一层只放通用能力，任何跟业务有关的逻辑都不该出现在这里。'),
    );

    // ── internal 层（第 1 层转发）──
    for (const [name, content] of Object.entries(INTERNAL_FILES)) {
      push('src/internal/' + name, content);
    }
    const internalSpec = [
      { var: 'core', from: '../core', symbols: coreNames },
      ...Object.entries(INTERNAL_MODULES).map(([file, symbols]) => ({
        var: varOf(file),
        from: './' + file.replace(/\.js$/, ''),
        symbols,
      })),
    ];
    const internalNames = internalSpec.flatMap((s) => s.symbols);
    push(
      'src/internal/index.js',
      makeBarrel(
        internalSpec,
        'internal 层汇总 —— 内部能力，不对外承诺稳定性。\n *\n * ⚠️ 这一层直接透传 core，没有做任何替换。',
      ),
    );
    // ⚠️ internal/http.js：这一层替换了 truncate（字节级）
    push(
      'src/internal/http.js',
      makeBarrel(
        [{ var: 'core', from: '../core', symbols: coreNames }],
        'HTTP 相关能力的内部层。\n *\n * ⚠️ 这一份里的 truncate 用的是 core/legacy 那套 —— 老 HTTP 预览接口\n *    一直是这个行为，前端那边也按这个渲染的。',
        '  truncate: legacyTruncate,',
      ).replace(
        "const core = require('../core');",
        "const core = require('../core');\nconst { legacyTruncate } = require('../core/legacy');",
      ),
    );

    // ── public 层（第 2 层转发）──
    for (const [name, content] of Object.entries(PUBLIC_FILES)) {
      push('src/public/' + name, content);
    }
    const publicSpec = [
      { var: 'internal', from: '../internal', symbols: internalNames },
      ...Object.entries(PUBLIC_MODULES).map(([file, symbols]) => ({
        var: varOf(file),
        from: './' + file.replace(/\.js$/, ''),
        symbols,
      })),
    ];
    const publicNames = publicSpec.flatMap((s) => s.symbols);
    push(
      'src/public/index.js',
      makeBarrel(publicSpec, 'public 层汇总 —— 对外承诺稳定性的那一层。'),
    );
    push(
      'src/public/http.js',
      makeBarrel(
        [{ var: 'internalHttp', from: '../internal/http', symbols: coreNames }],
        'public 层的 HTTP 分册 —— 直接转发 internal/http。',
      ),
    );
    // ⚠️ public/cli.js：第二处替换
    push(
      'src/public/cli.js',
      makeBarrel(
        [{ var: 'internal', from: '../internal', symbols: internalNames }],
        'public 层的 CLI 分册。\n *\n * ⚠️ CLI 的输出宽度是按老规矩算的，所以截断走的也是 core/legacy 那套。',
        '  truncate: legacyTruncate,',
      ).replace(
        "const internal = require('../internal');",
        "const internal = require('../internal');\nconst { legacyTruncate } = require('../core/legacy');",
      ),
    );
    // ⚠️ public/feed.js：第三处替换
    push(
      'src/public/feed.js',
      makeBarrel(
        [{ var: 'internal', from: '../internal', symbols: internalNames }],
        'public 层的 feed 分册（给外部聚合方订阅用）。\n *\n * ⚠️ feed 的标题截断也是老规矩，走 core/legacy。',
        '  truncate: legacyTruncate,',
      ).replace(
        "const internal = require('../internal');",
        "const internal = require('../internal');\nconst { legacyTruncate } = require('../core/legacy');",
      ),
    );

    // ── api 层（第 3 层转发 = 对外入口）──
    for (const [name, content] of Object.entries(API_FILES)) {
      push('src/api/' + name, content);
    }
    const apiSpec = [
      { var: 'pub', from: '../public', symbols: publicNames },
      ...Object.entries(API_MODULES).map(([file, symbols]) => ({
        var: varOf(file),
        from: './' + file.replace(/\.js$/, ''),
        symbols,
      })),
    ];
    push('src/api/index.js', makeBarrel(apiSpec, '对外 API 主入口。'));
    push(
      'src/api/http.js',
      makeBarrel(
        [{ var: 'pubHttp', from: '../public/http', symbols: coreNames }],
        '对外 API 的 HTTP 分册。',
      ),
    );
    push(
      'src/api/cli.js',
      makeBarrel(
        [{ var: 'pubCli', from: '../public/cli', symbols: internalNames }],
        '对外 API 的 CLI 分册。',
      ),
    );
    push(
      'src/api/feed.js',
      makeBarrel(
        [{ var: 'pubFeed', from: '../public/feed', symbols: internalNames }],
        '对外 API 的 feed 分册。',
      ),
    );

    // ── 消费方 ──
    for (const [name, content] of Object.entries(FEATURE_FILES)) {
      push('src/features/' + name, content);
    }
    for (const [name, content] of Object.entries(WIDGET_FILES)) {
      push('src/widgets/' + name, content);
    }
    for (const [name, content] of Object.entries(UTIL_FILES)) {
      push('src/utils/' + name, content);
    }

    // ── 入口 ──
    push(
      'index.js',
      `#!/usr/bin/env node
/**
 * 库的入口 —— 只是把 public 层再包一层，方便 require。
 */
const pub = require('./src/public');

/** 对外暴露的全部符号 */
function describe() {
  return Object.keys(pub).sort();
}

if (require.main === module) {
  console.log(describe().join('\\n'));
}

module.exports = pub;
module.exports.describe = describe;
`,
    );
    push(
      'README.md',
      `# 内核工具库

一个分层的多模块工具库：

| 层 | 目录 | 说明 |
|---|---|---|
| core | \`src/core/\` | 无业务语义的通用函数 |
| internal | \`src/internal/\` | 内部能力，**不承诺**稳定性 |
| public | \`src/public/\` | 对外承诺稳定性的 API |
| api | \`src/api/\` | 对外入口，按用途分成几个分册 |

## 分层规矩

每一层都可以转发下一层的符号，但**转发不等于透传** ——
某一层可能对某些符号做了替换（历史原因）。

所以"我改了 core 里的函数，为什么对外的行为没变"这类问题，
答案通常在中间某一层的转发文件里。

## 消费方

- \`src/features/\` —— 业务功能
- \`src/widgets/\` —— 展示组件
- \`src/utils/\` —— 工具层
`,
    );

    writeTree(initialDir, files);
    return statsOf(initialDir);
  },
};
