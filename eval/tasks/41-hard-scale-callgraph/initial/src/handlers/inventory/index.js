/**
 * 库存域的内置 handler 清单。
 *
 * 这里的 require 有两个作用：
 *   1. 让 handler 文件被加载（自注册就是这么发生的）
 *   2. 把它们汇总成一个数组交给加载器
 */
const stock = require('./stock');
const reserve = require('./reserve');
const reorder = require('./reorder');
const shrink = require('./shrink');
const audit = require('./audit');
const transfer = require('./transfer');

module.exports = [stock, reserve, reorder, shrink, audit, transfer];
