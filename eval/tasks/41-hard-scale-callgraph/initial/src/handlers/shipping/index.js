/**
 * 履约域的内置 handler 清单。
 *
 * 这里的 require 有两个作用：
 *   1. 让 handler 文件被加载（自注册就是这么发生的）
 *   2. 把它们汇总成一个数组交给加载器
 */
const label = require('./label');
const rate = require('./rate');
const track = require('./track');
const dispatch = require('./dispatch');
const customs = require('./customs');
const returnOrder = require('./returnOrder');

module.exports = [label, rate, track, dispatch, customs, returnOrder];
