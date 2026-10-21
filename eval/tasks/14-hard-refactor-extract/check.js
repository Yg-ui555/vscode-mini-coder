/**
 * 验收脚本
 *
 * ⭐ 本题的核心：processOrder 的输出必须【一字不差】。
 *   下面 7 组期望值都是用初始版本的代码实际跑出来的，
 *   已硬编码进来。任何格式改动都会被抓住。
 *
 *   注意 freeShipping 那组：期望值是【加了免邮规则之后】的结果，
 *   初始代码跑出来是 "运费: 10.00 / 总计: 310.00"，
 *   所以这组在 baseline 是挂的（本题目标之一）。
 */

const assert = require('assert');
const path = require('path');

// ═══ 用初始版本实际跑出来的精确输出（已考虑免邮规则）═══
//
// ⚠️ 免邮门槛是「小计 − 折扣 ≥ 200」，所以：
//   withPromoPercent: 小计200 − 折扣20 = 180 < 200 → 仍收 10 元运费（输出不变）
//   noItems         : 0 < 200 → 仍收 10 元运费（输出不变）
//   freeShipping    : 300 ≥ 200 → 免运费（这一组是本题目标，baseline 挂）
// 也就是说只有 freeShipping 一组会因为新规则而改变输出 —— 它就是本题唯一的"新行为"。
const BASELINE_OUTPUT = {
  simple:
    '=== 订单 ===\n  笔 x2\n小计: 20.00\n运费: 10.00\n总计: 30.00',
  withPromoPercent:
    '=== 订单 ===\n  书 x1\n小计: 200.00\n折扣: -20.00\n运费: 10.00\n总计: 190.00',
  withPromoFixed:
    '=== 订单 ===\n  杯 x1\n小计: 80.00\n折扣: -50.00\n运费: 25.00\n总计: 55.00',
  badPrice:
    '=== 订单 ===\n  坏 x1\n  好 x1\n小计: 30.00\n运费: 10.00\n总计: 40.00\n警告:\n  无效价格: 坏',
  freeShipping:
    '=== 订单 ===\n  大件 x1\n小计: 300.00\n运费: 0.00\n总计: 300.00',
  noItems: '=== 订单 ===\n小计: 0.00\n运费: 10.00\n总计: 10.00',
  invalid: 'ERROR: 订单格式错误',
};

const ORDERS = {
  simple: { items: [{ name: '笔', price: 10, quantity: 2 }], shippingMethod: 'standard' },
  withPromoPercent: { items: [{ name: '书', price: 200 }], promo: 'SAVE10', shippingMethod: 'standard' },
  withPromoFixed: { items: [{ name: '杯', price: 80 }], promo: 'SAVE50', shippingMethod: 'express' },
  badPrice: {
    items: [
      { name: '坏', price: -5, quantity: 1 },
      { name: '好', price: 30, quantity: 1 },
    ],
    shippingMethod: 'standard',
  },
  freeShipping: { items: [{ name: '大件', price: 300 }], shippingMethod: 'standard' },
  noItems: { items: [] },
  invalid: {},
};

module.exports = {
  taskId: '14-hard-refactor-extract',

  cases: [
    // ═══ 本题目标（baseline 挂）═══
    {
      name: '⭐ processOrder 输出与初始版本一字不差（7 组订单全测）',
      fn: ({ dir }) => {
        const { processOrder } = require(path.join(dir, 'processor.js'));
        for (const [key, order] of Object.entries(ORDERS)) {
          const got = processOrder(order);
          assert.strictEqual(
            got,
            BASELINE_OUTPUT[key],
            `\n【${key} 组】输出不一致\n期望：\n${JSON.stringify(BASELINE_OUTPUT[key])}\n实际：\n${JSON.stringify(got)}`,
          );
        }
      },
    },
    {
      name: 'calcShipping 已导出且是函数',
      fn: ({ dir }) => {
        const mod = require(path.join(dir, 'processor.js'));
        assert.strictEqual(typeof mod.calcShipping, 'function', 'calcShipping 未导出');
      },
    },
    {
      name: '⭐ calcShipping 满 200 免运费',
      fn: ({ dir }) => {
        const { calcShipping } = require(path.join(dir, 'processor.js'));
        assert.strictEqual(calcShipping(200, 'standard'), 0, '正好 200 应免运费');
        assert.strictEqual(calcShipping(500, 'standard'), 0, '500 应免运费');
        assert.strictEqual(calcShipping(199.99, 'standard'), 10, '199.99 不该免运费');
        assert.strictEqual(calcShipping(100, 'standard'), 10, '100 应收 10 元运费');
      },
    },
    {
      name: '⭐ calcShipping 免邮规则对 express 同样生效',
      fn: ({ dir }) => {
        const { calcShipping } = require(path.join(dir, 'processor.js'));
        assert.strictEqual(calcShipping(300, 'express'), 0, 'express 满 200 也该免运费');
        assert.strictEqual(calcShipping(50, 'express'), 25, 'express 未达门槛收 25');
      },
    },
    {
      name: 'calcShipping 未知配送方式回退到 standard',
      fn: ({ dir }) => {
        const { calcShipping } = require(path.join(dir, 'processor.js'));
        assert.strictEqual(calcShipping(50, 'unknown'), 10, '未知方式应回退到 10');
        assert.strictEqual(calcShipping(50, undefined), 10, '未指定方式应为 10');
      },
    },
    {
      name: '拆分出了多个职责单一的函数（不是全塞在一个里）',
      fn: ({ dir }) => {
        const mod = require(path.join(dir, 'processor.js'));
        const exported = Object.keys(mod).filter((k) => typeof mod[k] === 'function');
        // 除 processOrder / calcShipping 外，还应有 2 个以上拆分出的函数
        const others = exported.filter((k) => k !== 'processOrder' && k !== 'calcShipping');
        assert.ok(
          others.length >= 2,
          `只导出了 ${exported.join(', ')} —— 说明没真正拆分，` +
            `至少还该导出校验/小计/促销/格式化里的几个`,
        );
      },
    },
    {
      name: 'processOrder 里重复的促销判断被去重了（提示性检查）',
      fn: ({ dir }) => {
        const src = require('fs').readFileSync(path.join(dir, 'processor.js'), 'utf-8');
        const processOrderBody = src.split('function processOrder')[1] || '';
        // 初始代码里 promo.type 有 if/else if 两个分支各算一次折扣
        // 重构后判断应已挪到独立函数里，processOrder 里不该再有促销分支
        assert.ok(
          !/if\s*\(\s*promo\.type\s*===/.test(processOrderBody),
          'processOrder 里仍有 promo.type 分支 —— 促销逻辑没抽出去',
        );
      },
    },

    // ═══ 回归守卫（baseline 必须通过）═══
    {
      name: '回归守卫：processOrder 导出没坏',
      fn: ({ dir }) => {
        const mod = require(path.join(dir, 'processor.js'));
        assert.strictEqual(typeof mod.processOrder, 'function', 'processOrder 必须是函数');
      },
    },
    {
      name: '回归守卫：无效价格的警告行没被删掉',
      fn: ({ dir }) => {
        const { processOrder } = require(path.join(dir, 'processor.js'));
        const out = processOrder(ORDERS.badPrice);
        assert.ok(out.includes('警告:'), '警告标题丢了');
        assert.ok(out.includes('无效价格: 坏'), '具体警告内容丢了');
      },
    },
    {
      name: '回归守卫：无效订单仍返回原样的错误字符串',
      fn: ({ dir }) => {
        const { processOrder } = require(path.join(dir, 'processor.js'));
        assert.strictEqual(processOrder({}), 'ERROR: 订单格式错误');
        assert.strictEqual(processOrder(null), 'ERROR: 订单格式错误');
      },
    },
    {
      name: '回归守卫：促销折扣计算正确且用 toFixed(2)',
      fn: ({ dir }) => {
        const { processOrder } = require(path.join(dir, 'processor.js'));
        const out = processOrder(ORDERS.withPromoPercent);
        // 小计 200 − 折扣 20 = 180< 200 → 不免邮，运费仍 10
        assert.ok(out.includes('折扣: -20.00'), `折扣行不对，实际输出：\n${out}`);
        assert.ok(out.includes('总计: 190.00'), `总计行不对，实际输出：\n${out}`);
        assert.ok(out.includes('运费: 10.00'), `运费行不对，实际输出：\n${out}`);
      },
    },
    {
      name: '回归守卫：促销折扣不会超过小计（SAVE50 用在 30 元商品上）',
      fn: ({ dir }) => {
        const { processOrder } = require(path.join(dir, 'processor.js'));
        const out = processOrder({ items: [{ name: '小', price: 30 }], promo: 'SAVE50' });
        assert.ok(out.includes('折扣: -30.00'), `折扣应被限制为 30，实际：\n${out}`);
        assert.ok(out.includes('小计: 30.00'), `小计不应变成负数，实际：\n${out}`);
      },
    },
  ],
};