/**
 * 通知域的内置 handler 清单。
 *
 * 这里的 require 有两个作用：
 *   1. 让 handler 文件被加载（自注册就是这么发生的）
 *   2. 把它们汇总成一个数组交给加载器
 */
const email = require('./email');
const sms = require('./sms');
const push = require('./push');
const webhook = require('./webhook');
const digest = require('./digest');
const preference = require('./preference');

module.exports = [email, sms, push, webhook, digest, preference];
