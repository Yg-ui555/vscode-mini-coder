/**
 * 15-hard-grep-discipline 的标准答案
 *
 * ⭐ 这份文件的作用是【证明这道题可解】。
 *   一道题如果连人写的正确答案都过不了断言，那它就不是难题，是废题——
 *   而且废题会以"满分"的形式混进评测集，比没有题更糟。
 *
 * verifySolvable.ts 会把 initial/ 复制到沙箱、执行本文件、然后跑全部 case，
 * 要求【一个都不挂】。
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  taskId: '15-hard-grep-discipline',

  apply(dir) {
    // 1. format.js：删掉 legacyFormat，只留 formatMoney
    fs.writeFileSync(
      path.join(dir, 'src/format.js'),
      [
        '/**',
        ' * 金额格式化 —— 新旧两套实现并存，迁移中。',
        ' *',
        ' * legacyFormat 是老实现：先转字符串再补零，负数会多出一个减号位。',
        ' * formatMoney 是新实现：直接用 toFixed(2)。',
        ' * 两者的输出在【正数】上逐字相同，所以迁移是一个纯重构。',
        ' */',
        '',
        '/** 新实现 —— 所有调用点最终都应该指向这里 */',
        'function formatMoney(cents) {',
        "  return '¥' + (cents / 100).toFixed(2);",
        '}',
        '',
        'module.exports = { formatMoney };',
        '',
      ].join('\n'),
      'utf-8'
    );

    // 2. 三个调用点：解构名 + 调用名一起换
    const callers = ['src/checkout.js', 'src/pricing.js', 'src/reports/invoice.js'];
    for (const rel of callers) {
      const file = path.join(dir, rel);
      let src = fs.readFileSync(file, 'utf-8');
      src = src.replace(/\{ legacyFormat \}/, '{ formatMoney }');
      src = src.replace(/\blegacyFormat\(/g, 'formatMoney(');
      fs.writeFileSync(file, src, 'utf-8');
    }

    // 3. legacy-html.js 和 index.js 一律不碰
  },
};