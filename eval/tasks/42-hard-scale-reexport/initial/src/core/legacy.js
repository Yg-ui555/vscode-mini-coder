/**
 * 旧版字符串工具 —— 按【字节】处理。
 *
 * ⚠️ 这份实现只服务两类老链路：
 *   1. 日志摘要（要把一整行日志压到固定宽度）
 *   2. 老版本的 HTTP 预览接口
 *
 *   它对多字节字符会切出半个字（显示成乱码），但老链路一直在用，
 *   所以这个行为是被下游依赖着的。
 */
function legacyTruncate(text, max) {
  const buf = Buffer.from(String(text == null ? '' : text), 'utf-8');
  if (buf.length <= max) return buf.toString('utf-8');
  return buf.slice(0, max).toString('utf-8') + '...';
}

/** 旧版左补齐（按字节算宽度） */
function legacyPadStart(text, width) {
  const buf = Buffer.from(String(text == null ? '' : text), 'utf-8');
  if (buf.length >= width) return buf.toString('utf-8');
  return ' '.repeat(width - buf.length) + buf.toString('utf-8');
}

module.exports = { legacyTruncate, legacyPadStart };
