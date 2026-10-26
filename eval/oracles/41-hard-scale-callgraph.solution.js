/**
 * 标准答案 —— 41-hard-scale-callgraph
 *
 * 目的：证明这道题【有解】。
 *
 * 标准解法（6 步，每步改一个文件）：
 *   1. src/handlers/billing/refund.js    —— 返回裸值 → ok(...)
 *   2. src/handlers/inventory/reserve.js —— 同上
 *   3. src/handlers/shipping/dispatch.js —— 同上
 *   4. src/handlers/notify/digest.js     —— 同上
 *   5. src/extensions/backup.plugin.js    —— 同上（⭐ 运行期才被发现的那一批）
 *   6. src/extensions/reindex.plugin.js   —— 同上（⭐ 同上）
 *
 * ⚠️ 第 5、6 步是本题的判分点：
 *   插件文件里【没有】register()，只按 "register(" 去搜是搜不到它们的。
 *   顺着 import 链也找不到 —— 它们是加载器在运行期扫目录发现的。
 */

const fs = require('fs');
const path = require('path');

/** 读改写 */
function patch(dir, rel, fn) {
  const p = path.join(dir, rel);
  const src = fs.readFileSync(p, 'utf-8');
  fs.writeFileSync(p, fn(src), 'utf-8');
}

/**
 * 把"返回裸值"改成"返回 ok(裸值)"。
 *
 * ⚠️ 顺手把 contract 的 require 补上 —— 原来那些文件根本没引过 contract。
 */
function toContract(src, contractPath) {
  let out = src;

  if (!/require\(['"][^'"]*contract['"]\)/.test(out)) {
    const anchor = out.match(/^const .*require\([^)]*\);\n/m);
    if (anchor) {
      out = out.replace(anchor[0], anchor[0] + `const { ok } = require('${contractPath}');\n`);
    } else {
      // 没有 require 行的文件（插件）→ 插在文件头注释之后
      const commentEnd = out.indexOf('*/') + 2;
      out = out.slice(0, commentEnd) + `\n\nconst { ok } = require('${contractPath}');` + out.slice(commentEnd);
    }
  }

  const before = out;
  out = out.replace(
    /^(\s*)return \{ (group: '[^']+', name: '[^']+', amount, label, total: amount \* 2) \};$/m,
    '$1return ok({ $2 });',
  );
  if (out === before) {
    throw new Error('标准答案的锚点没找到（裸值 return 那行）');
  }
  return out;
}

/** 内置 handler（自注册，contract 在 ../../core/contract） */
const CORE_HANDLERS = [
  'src/handlers/billing/refund.js',
  'src/handlers/inventory/reserve.js',
  'src/handlers/shipping/dispatch.js',
  'src/handlers/notify/digest.js',
];

/** 扩展插件（运行期加载，contract 在 ../core/contract） */
const PLUGINS = ['src/extensions/backup.plugin.js', 'src/extensions/reindex.plugin.js'];

module.exports = {
  taskId: '41-hard-scale-callgraph',

  apply(dir) {
    // ── 4 个内置 handler ──
    for (const rel of CORE_HANDLERS) {
      patch(dir, rel, (src) => toContract(src, '../../core/contract'));
    }

    // ── 2 个扩展插件 ⭐ 漏掉这两个，这道题就过不了 ──
    for (const rel of PLUGINS) {
      patch(dir, rel, (src) => toContract(src, '../core/contract'));
    }
  },
};
