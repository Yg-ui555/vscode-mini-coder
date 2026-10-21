/**
 * 示例入口：跑一遍报表和汇总
 */

const { Circle, Square } = require('./shapes');
const { buildReport, buildSummary, buildFromNames } = require('./report');

/** 示例用的图形描述 */
const DEMO = [
  { type: 'circle', value: 1 },
  { type: 'square', value: 2 },
  { type: 'circle', value: 3 },
];

/** 直接用类构造出来的图形 */
function demoShapes() {
  return [new Circle(1), new Square(2), new Circle(3)];
}

/** 示例主流程 */
function main() {
  const fromNames = buildFromNames(DEMO);
  return [
    '## report',
    buildReport(demoShapes()),
    '## summary',
    buildSummary(fromNames),
  ].join('\n');
}

module.exports = { main, demoShapes, DEMO };