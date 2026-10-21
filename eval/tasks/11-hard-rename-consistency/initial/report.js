/**
 * 报表生成
 *
 * buildReport / buildSummary 的输出格式已经被下游消费，
 * 重构或改名的时候**一个字符都不能变**。
 */

const { Circle, Square } = require('./shapes');

/** 保留两位小数，避免浮点噪声进入报表 */
function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * 按 name 列表构造图形实例
 * @param {Array<{type: string, value: number}>} list
 */
function buildFromNames(list) {
  const source = Array.isArray(list) ? list : [];
  const shapes = [];
  for (const item of source) {
    if (!item) continue;
    if (item.type === 'circle') {
      shapes.push(new Circle(item.value));
    } else if (item.type === 'square') {
      shapes.push(new Square(item.value));
    }
  }
  return shapes;
}

/**
 * 生成明细报表：每行一个图形，最后一行是合计
 */
function buildReport(shapes) {
  const list = Array.isArray(shapes) ? shapes : [];
  const areas = list.map((s) => round(s.area()));
  const total = round(areas.reduce((a, b) => a + b, 0));
  const body = areas.map((a, i) => `#${i + 1}=${a}`);
  return [`count=${list.length}`, `total=${total}`, ...body].join('\n');
}

/**
 * 生成类型汇总，形如 summary(3) circle:2,square:1
 */
function buildSummary(shapes) {
  const list = Array.isArray(shapes) ? shapes : [];
  const counts = new Map();
  for (const s of list) {
    const t = typeof s.type === 'function' ? s.type() : 'unknown';
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const parts = Array.from(counts.keys())
    .sort()
    .map((k) => `${k}:${counts.get(k)}`);
  return `summary(${list.length}) ${parts.join(',')}`;
}

module.exports = { buildReport, buildSummary, buildFromNames };