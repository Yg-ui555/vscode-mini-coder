/**
 * 验收脚本 —— 跨文件重命名一致性
 *
 * 判定要点：
 *   1. 新导出名必须出现（baseline 挂）
 *   2. 三个文件里都不能残留旧标识符（baseline 挂）—— 这是本题最容易漏的地方
 *   3. 所有输出必须与改名前逐字一致（回归守卫，baseline 过）
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

/** 沙箱目录下所有 .js 文件（递归） */
function listJsFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full, rel));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** main() / buildReport() 的逐字基准值（改名前算出来的） */
const MAIN_BASELINE =
  '## report\ncount=3\ntotal=35.41\n#1=3.14\n#2=4\n#3=28.27\n## summary\nsummary(3) circle:2,square:1';
const REPORT_BASELINE = 'count=3\ntotal=35.41\n#1=3.14\n#2=4\n#3=28.27';
const SUMMARY_BASELINE = 'summary(3) circle:2,square:1';

module.exports = {
  taskId: '11-hard-rename-consistency',

  cases: [
    {
      // ⭐ baseline 挂：shapes.js 必须导出新名字
      name: '新导出名 RoundShape / QuadShape 存在且可用',
      fn: ({ dir }) => {
        const shapes = require(path.join(dir, 'shapes.js'));
        assert.ok(shapes.RoundShape, 'shapes.js 应导出 RoundShape');
        assert.ok(shapes.QuadShape, 'shapes.js 应导出 QuadShape');
        assert.strictEqual(
          typeof shapes.RoundShape,
          'function',
          'RoundShape 应该是类/构造函数'
        );
        assert.strictEqual(
          typeof shapes.QuadShape,
          'function',
          'QuadShape 应该是类/构造函数'
        );

        // 新类要能正常构造并算面积
        const c = new shapes.RoundShape(1);
        const s = new shapes.QuadShape(2);
        assert.strictEqual(Math.round(c.area() * 100) / 100, 3.14, 'RoundShape(1) 面积应为 3.14');
        assert.strictEqual(s.area(), 4, 'QuadShape(2) 面积应为 4');
        assert.strictEqual(c.type(), 'circle', "type() 业务标签应仍是 'circle'");
        assert.strictEqual(s.type(), 'square', "type() 业务标签应仍是 'square'");
      },
    },

    {
      // ⭐ baseline 挂：三个文件都不能再有旧标识符
      name: '所有 .js 文件都不再残留 Circle / Square 标识符',
      fn: ({ dir }) => {
        const files = listJsFiles(dir);
        assert.ok(files.length >= 3, `至少应保留 3 个 .js 文件，实际 ${files.length}`);

        // 三个关键文件必须都还在
        for (const f of ['shapes.js', 'report.js', 'index.js']) {
          assert.ok(
            fs.existsSync(path.join(dir, f)),
            `${f} 不该被删除或改名`
          );
        }

        for (const file of files) {
          const src = fs.readFileSync(file, 'utf-8');
          const rel = path.relative(dir, file);
          // 大小写敏感的单词匹配：'circle' / 'square' 小写业务标签不算残留
          if (/\bCircle\b/.test(src)) {
            throw new assert.AssertionError({
              message: `${rel} 里还残留旧名字 Circle`,
            });
          }
          if (/\bSquare\b/.test(src)) {
            throw new assert.AssertionError({
              message: `${rel} 里还残留旧名字 Square`,
            });
          }
        }
      },
    },

    {
      // ⭐ baseline 挂：index.js 必须真的用上了新类（不能只改 shapes.js）
      name: 'index.js 的 demoShapes() 返回的是新类的实例',
      fn: ({ dir }) => {
        const idx = require(path.join(dir, 'index.js'));
        const shapes = require(path.join(dir, 'shapes.js'));
        assert.strictEqual(
          typeof idx.demoShapes,
          'function',
          'index.js 应继续导出 demoShapes()'
        );
        const list = idx.demoShapes();
        assert.ok(Array.isArray(list) && list.length === 3, 'demoShapes() 应返回 3 个图形');
        assert.ok(
          list[0] instanceof shapes.RoundShape,
          'demoShapes() 的第 1 个应是 RoundShape 实例，说明 index.js 也改了'
        );
        assert.ok(
          list[1] instanceof shapes.QuadShape,
          'demoShapes() 的第 2 个应是 QuadShape 实例，说明 index.js 也改了'
        );
        assert.ok(
          list[2] instanceof shapes.RoundShape,
          'demoShapes() 的第 3 个应是 RoundShape 实例，说明 index.js 也改了'
        );
      },
    },

    {
      // ⭐ baseline 挂：旧名字不能再出现在导出表里
      name: '旧导出名 Circle / Square 已从 module.exports 移除',
      fn: ({ dir }) => {
        const shapes = require(path.join(dir, 'shapes.js'));
        assert.strictEqual(
          shapes.Circle,
          undefined,
          'shapes.js 不应再导出 Circle'
        );
        assert.strictEqual(
          shapes.Square,
          undefined,
          'shapes.js 不应再导出 Square'
        );
        // 也没必要留别名兼容，导出表应恰好是这两个新类
        const keys = Object.keys(shapes).sort();
        assert.deepStrictEqual(
          keys,
          ['QuadShape', 'RoundShape'],
          'shapes.js 的导出应恰好是 RoundShape 和 QuadShape，不多不少'
        );
      },
    },

    {
      // 回归守卫：buildReport 输出逐字不变
      name: '【回归】buildReport 输出与改名前逐字一致',
      fn: ({ dir }) => {
        const rep = require(path.join(dir, 'report.js'));
        const idx = require(path.join(dir, 'index.js'));

        assert.strictEqual(
          rep.buildReport(rep.buildFromNames(idx.DEMO)),
          REPORT_BASELINE,
          'buildReport 的输出格式不能变'
        );
        assert.strictEqual(rep.buildReport([]), 'count=0\ntotal=0', '空数组应输出 count=0/total=0');
        assert.strictEqual(rep.buildReport(null), 'count=0\ntotal=0', '非数组入参应兜底为空报表');
        assert.strictEqual(
          rep.buildReport(rep.buildFromNames([{ type: 'square', value: 3 }])),
          'count=1\ntotal=9\n#1=9',
          '单个 square 的报表不能变'
        );
        // 无效类型应被跳过
        assert.strictEqual(
          rep.buildReport(
            rep.buildFromNames([
              null,
              { type: 'hexagon', value: 1 },
              { type: 'circle', value: 1 },
            ])
          ),
          'count=1\ntotal=3.14\n#1=3.14',
          '未知类型应被过滤掉'
        );
      },
    },

    {
      // 回归守卫：buildSummary / main() 输出逐字不变
      name: '【回归】buildSummary / main() 输出与改名前逐字一致',
      fn: ({ dir }) => {
        const rep = require(path.join(dir, 'report.js'));
        const idx = require(path.join(dir, 'index.js'));

        assert.strictEqual(
          rep.buildSummary(rep.buildFromNames(idx.DEMO)),
          SUMMARY_BASELINE,
          'buildSummary 的输出格式不能变'
        );
        assert.strictEqual(
          rep.buildSummary([]),
          'summary(0) ',
          '空数组应输出 "summary(0) "（注意有个尾随空格）'
        );
        assert.strictEqual(
          idx.main(),
          MAIN_BASELINE,
          'main() 的完整输出必须与改名前一字不差'
        );
      },
    },

    {
      // 回归守卫：类的其余方法没被改坏
      // 注意：这里刻意不直接引用类名，而是通过 buildFromNames 拿实例，
      // 这样改名前后都能跑，才能真正当「回归守卫」用。
      name: '【回归】area / perimeter / toString / scale 行为不变',
      fn: ({ dir }) => {
        const rep = require(path.join(dir, 'report.js'));

        const [circle, square] = rep.buildFromNames([
          { type: 'circle', value: 1 },
          { type: 'square', value: 3 },
        ]);
        assert.ok(circle && square, 'buildFromNames 应造出两个图形');

        assert.strictEqual(circle.area(), Math.PI, '圆面积公式不能变');
        assert.strictEqual(
          Math.round(circle.area() * 100) / 100,
          3.14,
          '圆面积取两位小数应为 3.14'
        );
        assert.strictEqual(square.area(), 9, '正方形面积公式不能变');
        assert.strictEqual(circle.perimeter(), 2 * Math.PI, '圆周长公式不能变');
        assert.strictEqual(square.perimeter(), 12, '正方形周长公式不能变');

        // toString 里的业务标签是小写，且不能被重命名波及
        const [, square5] = rep.buildFromNames([{ type: 'circle', value: 1 }, { type: 'square', value: 5 }]);
        assert.strictEqual(
          circle.toString(),
          'circle(r=1)',
          "toString 应仍是 'circle(r=1)'，业务标签不能跟着类名改"
        );
        assert.strictEqual(square5.toString(), 'square(s=5)', "toString 应仍是 'square(s=5)'");

        // scale 必须返回同类实例
        const scaledCircle = circle.scale(3);
        assert.strictEqual(scaledCircle.radius, 3, 'scale(3) 应把半径乘 3');
        assert.strictEqual(scaledCircle.type(), 'circle', 'scale() 后的类型标签不能变');
        const scaledSquare = square.scale(3);
        assert.strictEqual(scaledSquare.side, 9, 'scale(3) 应把边长乘 3');
        assert.strictEqual(scaledSquare.type(), 'square', 'scale() 后的类型标签不能变');
      },
    },

    {
      // 副作用守卫：没删别的导出、没改依赖关系
      name: '【副作用】report.js / index.js 的导出没被删改',
      fn: ({ dir }) => {
        const rep = require(path.join(dir, 'report.js'));
        const idx = require(path.join(dir, 'index.js'));

        assert.deepStrictEqual(
          Object.keys(rep).sort(),
          ['buildFromNames', 'buildReport', 'buildSummary'],
          'report.js 的导出应保持三个函数，不多不少'
        );
        assert.deepStrictEqual(
          Object.keys(idx).sort(),
          ['DEMO', 'demoShapes', 'main'],
          'index.js 的导出应保持不变'
        );
        assert.strictEqual(typeof rep.buildReport, 'function');
        assert.strictEqual(typeof rep.buildSummary, 'function');
        assert.strictEqual(typeof rep.buildFromNames, 'function');
        assert.strictEqual(typeof idx.main, 'function');

        // DEMO 常量也不能动（它驱动了 buildFromNames 的行为）
        assert.deepStrictEqual(
          idx.DEMO,
          [
            { type: 'circle', value: 1 },
            { type: 'square', value: 2 },
            { type: 'circle', value: 3 },
          ],
          'DEMO 常量不能被改'
        );

        // 文件数不变：不能靠新建/删除文件绕过检查
        const jsCount = listJsFiles(dir).length;
        assert.strictEqual(jsCount, 3, `应恰好保留 3 个 .js 文件，实际 ${jsCount}`);
      },
    },
  ],
};