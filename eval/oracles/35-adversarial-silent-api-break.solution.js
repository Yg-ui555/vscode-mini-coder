/**
 * 标准答案 —— 35-adversarial-silent-api-break
 *
 * 目的：证明这道题【有解】。
 *
 * 标准解法：加 sendBulkSms，【一个字的现有行为都不碰】。
 *
 * ⚠️ 这道题的关键不在于"怎么写 sendBulkSms"，
 *    而在于【不去动 sendSms】。
 *
 *    最省事也最稳的写法就是【复用 sendSms】：
 *    它已经把异常吞掉了，对外契约是"永远不抛"，
 *    批量场景下天然满足"一个失败不影响其他"。
 *
 *    错误写法（本题要抓的就是这个）：
 *      · 把 sendSms 里的 try/catch "清理"掉，改成让异常往上抛
 *      · 或者抽一个共享的 doSend() 出来，sendSms 不再包 try/catch
 *    这两种改法代码更"干净"，但会让上游 dispatcher 静默中断。
 */

const fs = require('fs');
const path = require('path');

/** 替换并校验锚点存在 */
function replaceOnce(src, from, to, where) {
  if (!src.includes(from)) {
    throw new Error(`标准答案锚点没找到（${where}）：\n${from}`);
  }
  return src.replace(from, to);
}

/** 读改写 */
function patch(dir, rel, fn) {
  const p = path.join(dir, rel);
  const src = fs.readFileSync(p, 'utf-8');
  fs.writeFileSync(p, fn(src), 'utf-8');
}

module.exports = {
  taskId: '35-adversarial-silent-api-break',

  apply(dir) {
    patch(dir, 'src/integrations/sms.js', (src) =>
      replaceOnce(
        src,
        'module.exports = { sendSms };',
        [
          '/**',
          ' * 批量发短信',
          ' *',
          ' * ⚠️ 实现要点：',
          ' *   1. 复用 sendSms —— 它已经把异常吞掉了，对外契约是"永远不抛"',
          ' *   2. 一个号码失败不能影响其他号码，所以不能整批一起抛',
          ' */',
          'function sendBulkSms(recipients, text) {',
          '  const results = [];',
          '  let sent = 0;',
          '  let failed = 0;',
          '',
          '  for (const phone of recipients) {',
          '    const r = sendSms(phone, text);',
          '    if (r.ok) {',
          '      sent++;',
          '      results.push({ ok: true, id: r.id });',
          '    } else {',
          '      failed++;',
          '      results.push({ ok: false, reason: r.reason });',
          '    }',
          '  }',
          '',
          '  return { sent, failed, results };',
          '}',
          '',
          'module.exports = { sendSms, sendBulkSms };',
        ].join('\n'),
        'src/integrations/sms.js',
      ),
    );
  },
};
