/**
 * 标准答案 —— 42-hard-scale-reexport
 *
 * 目的：证明这道题【有解】。
 *
 * 标准解法（3 步，每步改一个转发文件）：
 *   1. src/public/http.js —— 在这一层重新声明正确的 truncate
 *   2. src/public/cli.js  —— 同上
 *   3. src/public/feed.js —— 同上
 *
 * ⚠️ 为什么改 public 层、而不是改覆盖的源头（core/legacy）：
 *   老的字节级截断被三条内部链路依赖着
 *   （预览条 / 徽标 / 日志摘要）。
 *   改源头 → 那三条链路的输出也变了 → 回归。
 *
 * ⚠️ 为什么不是改 core/string.js：
 *   三个被覆盖的入口压根不看 core 的那份 —— 改了等于没改。
 *   而 core 那份被 api/index 直接用着，改它会动到本来正确的入口。
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

/**
 * 在转发文件里重新声明 truncate。
 *
 * @param {string} src       文件内容
 * @param {string} oldLine   原来的 truncate 那一行
 * @param {string} anchor    require 锚点（在这行后面插入新的 require）
 * @param {string} where     出错时的说明
 */
function reassertTruncate(src, oldLine, anchor, where) {
  let out = src;

  if (!/require\(['"][^'"]*core\/string['"]\)/.test(out)) {
    out = replaceOnce(
      out,
      anchor,
      anchor + "\nconst coreString = require('../core/string');",
      where + ' / require 锚点',
    );
  }

  out = replaceOnce(out, oldLine, '  truncate: coreString.truncate,', where + ' / truncate 行');
  return out;
}

module.exports = {
  taskId: '42-hard-scale-reexport',

  apply(dir) {
    // ── 1. public/http.js ──
    //    它的 truncate 来自 internal/http —— 那一层被替换成了老的字节级实现。
    //    在这一层重新声明正确的实现即可，不用动 internal。
    patch(dir, 'src/public/http.js', (src) =>
      reassertTruncate(
        src,
        '  truncate: internalHttp.truncate,',
        "const internalHttp = require('../internal/http');",
        'src/public/http.js',
      ),
    );

    // ── 2. public/cli.js ──
    patch(dir, 'src/public/cli.js', (src) =>
      reassertTruncate(
        src,
        '  truncate: legacyTruncate,',
        "const { legacyTruncate } = require('../core/legacy');",
        'src/public/cli.js',
      ),
    );

    // ── 3. public/feed.js ──
    patch(dir, 'src/public/feed.js', (src) =>
      reassertTruncate(
        src,
        '  truncate: legacyTruncate,',
        "const { legacyTruncate } = require('../core/legacy');",
        'src/public/feed.js',
      ),
    );
  },
};
