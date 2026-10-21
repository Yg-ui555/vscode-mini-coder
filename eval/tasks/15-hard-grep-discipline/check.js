/**
 * 验收脚本 —— legacyFormat → formatMoney 全量迁移
 *
 * 判定要点：
 *   1. legacyFormat 已从导出表移除            （baseline 挂）
 *   2. 三个调用点全部改用 formatMoney         （baseline 挂）
 *   3. 确实用过 grep 工具                     （baseline 挂，baseline 的 transcript 是空的）
 *   4. main() 输出逐字不变                     （回归守卫，baseline 过）
 *   5. legacy-html.js 一个字节都没被碰         （回归守卫，baseline 过）
 *   6. 文件集合与依赖关系不变                  （副作用守卫，baseline 过）
 *
 * ⚠️ case 3 是「工具纪律」断言，它是二元的（用过就是用过），
 *    不需要 LLM 打分。对应的要求写在 task.md 的「项目规约」里，
 *    所以没做到就是没做到，不存在"其实做到了只是没被发现"。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/** legacy-html.js 在初始状态下的 sha256 前 16 位 */
const LEGACY_HTML_SHA = '55ef7ac9d3d0f9e6';

/** index.js 的 sha256 前 16 位（防止有人改入口来绕过断言） */
const INDEX_SHA = '84ec490af344d10c';

/** 迁移前 main() 的完整输出，逐字基准 */
const MAIN_BASELINE =
  'A-1 ¥12.50\nB-7 ¥9.99\nC-3 ¥1.00\ntotal ¥23.49\n---\n' +
  'free=¥0.00,pro=¥99.00\n---\n' +
  'INV-1 due ¥45.00\nINV-2 due ¥0.01\n---\n' +
  '<table><tr><td>widget</td><td>12.50</td></tr><tr><td>gizmo</td><td>9.99</td></tr></table>';

/** 递归列出沙箱里所有 .js 文件的相对路径 */
function listJs(dir, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJs(full, rel));
    else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out.sort();
}

function sha16(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

module.exports = {
  taskId: '15-hard-grep-discipline',

  cases: [
    {
      // ⭐ baseline 挂
      name: 'src/format.js 只导出 formatMoney，legacyFormat 已消失',
      fn: ({ dir }) => {
        const fmt = require(path.join(dir, 'src/format.js'));

        assert.strictEqual(
          fmt.legacyFormat,
          undefined,
          'legacyFormat 仍在导出表里，说明调用点没迁完'
        );
        assert.strictEqual(
          typeof fmt.formatMoney,
          'function',
          'formatMoney 必须继续导出'
        );
        assert.deepStrictEqual(
          Object.keys(fmt).sort(),
          ['formatMoney'],
          'format.js 的导出应恰好只剩 formatMoney，不多不少'
        );

        // 新实现本身要是对的（否则迁移等于把好的换成了坏的）
        assert.strictEqual(fmt.formatMoney(1250), '¥12.50');
        assert.strictEqual(fmt.formatMoney(999), '¥9.99');
        assert.strictEqual(fmt.formatMoney(100), '¥1.00');
        assert.strictEqual(fmt.formatMoney(0), '¥0.00');
        assert.strictEqual(fmt.formatMoney(1), '¥0.01');
      },
    },

    {
      // ⭐ baseline 挂 —— 这条是本题的主体：三个调用点一个都不能漏
      name: '三个调用点（checkout / pricing / invoice）都已改用 formatMoney',
      fn: ({ dir }) => {
        const callers = [
          'src/checkout.js',
          'src/pricing.js',
          'src/reports/invoice.js',
        ];

        for (const rel of callers) {
          const file = path.join(dir, rel);
          assert.ok(fs.existsSync(file), `${rel} 不该被删除或改名`);

          const src = fs.readFileSync(file, 'utf-8');

          // 只查【代码里的调用】，注释里提一嘴不算。
          // 判据：解构里不能再出现 legacyFormat。
          const importLine = src.match(/const\s*\{([^}]*)\}\s*=\s*require\([^)]*format[^)]*\)/);
          assert.ok(
            importLine,
            `${rel} 应该有从 format 模块解构 import 的语句`
          );
          assert.ok(
            !/\blegacyFormat\b/.test(importLine[1]),
            `${rel} 还在从 format 里解构 legacyFormat，导入行是：${importLine[0]}`
          );

          // 更强的判据：整个文件里（去掉注释行后）不能还有 legacyFormat 这个标识符
          const codeOnly = src
            .split('\n')
            .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
            .join('\n');
          assert.ok(
            !/\blegacyFormat\b/.test(codeOnly),
            `${rel} 的代码里还有 legacyFormat 调用，迁移不彻底`
          );
          assert.ok(
            /\bformatMoney\b/.test(codeOnly),
            `${rel} 还没用上 formatMoney`
          );
        }
      },
    },

    {
      // ⭐ baseline 挂 —— 工具纪律断言（transcript 在 baseline 阶段是空数组）
      name: '【工具纪律】查找引用时确实用了 grep 工具',
      fn: ({ transcript }) => {
        const grepCalls = transcript.filter((t) => t.tool === 'grep');
        assert.ok(
          grepCalls.length > 0,
          '本题规约要求用 grep 查找符号引用，但一次都没调用过 grep'
        );
        const okCalls = grepCalls.filter((t) => !t.isError);
        assert.ok(
          okCalls.length > 0,
          `调用了 ${grepCalls.length} 次 grep，但全是报错，说明正则/参数没写对：\n` +
            grepCalls.map((t) => '  - ' + t.preview).join('\n')
        );
      },
    },

    {
      // 回归守卫
      name: '【回归】index.js 的 main() 输出与迁移前逐字一致',
      fn: ({ dir }) => {
        const idx = require(path.join(dir, 'index.js'));
        assert.strictEqual(
          idx.main(),
          MAIN_BASELINE,
          'main() 的输出在迁移前后必须一字不差'
        );
      },
    },

    {
      // 回归守卫 + 诱饵守卫
      name: '【回归】src/reports/legacy-html.js 一个字节都没被碰过',
      fn: ({ dir }) => {
        const file = path.join(dir, 'src/reports/legacy-html.js');
        assert.ok(fs.existsSync(file), 'legacy-html.js 不该被删除或改名');
        assert.strictEqual(
          sha16(file),
          LEGACY_HTML_SHA,
          'legacy-html.js 被改了。它跟本次迁移无关，题目明确要求不动它'
        );

        // 行为上也再确认一遍（万一有人改了又改回来）
        const legacyHtml = require(file);
        assert.strictEqual(legacyHtml.amountCell(1250), '12.50', 'amountCell 行为不能变');
        assert.strictEqual(legacyHtml.amountCell(-450), '-4.50', 'amountCell 负号处理不能变');
        assert.strictEqual(
          legacyHtml.tableHtml(),
          '<table><tr><td>widget</td><td>12.50</td></tr><tr><td>gizmo</td><td>9.99</td></tr></table>',
          'tableHtml() 输出不能变'
        );

        // 它也不该被"顺手"改成依赖 format.js
        const src = fs.readFileSync(file, 'utf-8');
        assert.ok(
          !/require\([^)]*format/i.test(src),
          'legacy-html.js 不该被改成依赖 format.js——它输出的是不带 ¥ 的裸数字'
        );
      },
    },

    {
      // 副作用守卫
      name: '【副作用】文件集合、导出表、依赖关系都不变',
      fn: ({ dir }) => {
        // 文件集合不能变（不能靠新建/删除文件绕过）
        assert.deepStrictEqual(
          listJs(dir),
          [
            'index.js',
            'src/checkout.js',
            'src/format.js',
            'src/pricing.js',
            'src/reports/invoice.js',
            'src/reports/legacy-html.js',
          ],
          '仓库里的 .js 文件集合变了（多了或少了）'
        );

        // 入口不能被改
        assert.strictEqual(
          sha16(path.join(dir, 'index.js')),
          INDEX_SHA,
          'index.js 被改了——它只是入口，不该动'
        );

        // 各模块的导出表保持原样
        const idx = require(path.join(dir, 'index.js'));
        const checkout = require(path.join(dir, 'src/checkout.js'));
        const pricing = require(path.join(dir, 'src/pricing.js'));
        const invoice = require(path.join(dir, 'src/reports/invoice.js'));

        assert.deepStrictEqual(Object.keys(idx).sort(), ['main']);
        assert.deepStrictEqual(Object.keys(checkout).sort(), ['ITEMS', 'checkout', 'lineFor']);
        assert.deepStrictEqual(Object.keys(pricing).sort(), ['TIERS', 'priceList', 'priceTag']);
        assert.deepStrictEqual(Object.keys(invoice).sort(), ['ROWS', 'dueLine', 'invoice']);

        // 单个函数的输出也不能变
        assert.strictEqual(checkout.lineFor({ sku: 'A-1', price: 1250 }), 'A-1 ¥12.50');
        assert.strictEqual(pricing.priceTag({ name: 'pro', fee: 9900 }), 'pro=¥99.00');
        assert.strictEqual(invoice.dueLine({ ref: 'INV-2', due: 1 }), 'INV-2 due ¥0.01');
      },
    },
  ],
};