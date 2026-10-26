/**
 * 内置 handler 的汇总入口。
 *
 * 这里的 require 有两个作用：
 *   1. 让各组 handler 文件被加载（自注册就是这么发生的）
 *   2. 把它们汇总起来，方便加载器统一校验
 */
const billing = require('./billing');
const inventory = require('./inventory');
const shipping = require('./shipping');
const notify = require('./notify');

module.exports = {
  handlers: [...billing, ...inventory, ...shipping, ...notify],
};
