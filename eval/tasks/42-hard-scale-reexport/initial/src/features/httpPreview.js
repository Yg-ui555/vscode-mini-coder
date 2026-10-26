/**
 * HTTP 预览 —— 把响应体压成一行摘要。
 *
 * ⚠️ 这里的截断走的是内部层那一份（老的字节级语义），
 *    预览条的老样式就是这么渲染的。
 */
const { truncate } = require('../internal/http');

/** 生成一行预览 */
function preview(text, width) {
  return truncate(text, width === undefined ? 40 : width);
}

module.exports = { preview };
