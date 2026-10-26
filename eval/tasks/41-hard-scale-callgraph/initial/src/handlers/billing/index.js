/**
 * 账单域的内置 handler 清单。
 *
 * 这里的 require 有两个作用：
 *   1. 让 handler 文件被加载（自注册就是这么发生的）
 *   2. 把它们汇总成一个数组交给加载器
 */
const invoice = require('./invoice');
const refund = require('./refund');
const subscription = require('./subscription');
const dunning = require('./dunning');
const payout = require('./payout');
const tax = require('./tax');

module.exports = [invoice, refund, subscription, dunning, payout, tax];
