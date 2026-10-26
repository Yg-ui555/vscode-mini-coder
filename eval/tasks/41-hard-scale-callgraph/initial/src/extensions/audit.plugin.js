/**
 * 扩展插件 · 审计留痕
 *
 * ⚠️ 插件跟内置 handler 的登记方式【不一样】：
 *    内置 handler 自己调 register()，插件不调 —— 插件由加载器在运行期统一登记。
 *    所以在这个文件里 grep "register(" 是搜不到它的。
 */
const { ok } = require('../core/contract');

function run(input) {
  const amount = Math.round(Number(input.amount) || 0);
  const label = String(input.label == null ? '' : input.label);
  return ok({ group: 'ext', name: 'audit', amount, label, total: amount * 2 });
}

module.exports = { kind: 'ext.audit', run };
