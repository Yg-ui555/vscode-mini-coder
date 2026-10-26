#!/usr/bin/env node
/**
 * 规模题生成器 —— 一次性生成 41-44 四道题的 initial/ 目录
 *
 * ⭐ 这 4 道题存在的理由（见 eval/ABLATION.md）：
 *
 *   消融实验把 grep + run_shell 一起摘掉，agent 照样 28/28 全过。
 *   根因不是陷阱不够深，而是【代码库只有 5-9 个文件】——
 *   通读就够，规模根本没成为瓶颈。
 *
 *   所以这 4 道题统一的设计目标是：**让"找全调用点"变成一个必须靠搜索、
 *   而且搜索策略选错就会漏的活**。
 *
 *   | 题号 | 规模 | 陷阱 |
 *   |---|---|---|
 *   | 41 | 70+ 文件 / 11 目录 | 扩展插件运行期才被发现，grep register( 搜不到 |
 *   | 42 | 60+ 文件 / 9 目录  | 3 层转发链 + 分层覆盖，真正生效的实现不在你以为的地方 |
 *   | 43 | 60+ 文件 / 2 包     | 改了 A 包签名，B 包 4 个目录 + 变参转发的调用点 |
 *   | 44 | 1 个 800 行 + 20 依赖 | 优化热路径时最容易破坏依赖方依赖的边界语义 |
 *
 * 用法：
 *   node eval/tasks/_gen/scaleTasks.js        # 全部生成
 *   node eval/tasks/_gen/scaleTasks.js 41 43 # 只生成指定的题
 *
 * ⚠️ 幂等：每次都是先删 initial/ 再重建，跑一百遍结果一样。
 */

const path = require('path');
const { execFileSync } = require('child_process');
const { TASKS_DIR } = require('./lib');

const GENERATORS = [
  { id: '41-hard-scale-callgraph', mod: './gen41' },
  { id: '42-hard-scale-reexport', mod: './gen42' },
  { id: '43-hard-scale-monorepo', mod: './gen43' },
  { id: '44-hard-scale-perf-behavior', mod: './gen44' },
];

function main(argv) {
  const wanted = argv.slice(2).filter((a) => /^\d+$/.test(a));
  const picked = wanted.length
    ? GENERATORS.filter((g) => wanted.some((w) => g.id.startsWith(w)))
    : GENERATORS;

  if (!picked.length) {
    console.error('没有匹配的题目：' + wanted.join(', '));
    console.error('可选：' + GENERATORS.map((g) => g.id).join(', '));
    process.exit(1);
  }

  console.log('\n生成规模题的初始代码：\n');

  for (const g of picked) {
    const generator = require(g.mod);
    const taskDir = path.join(TASKS_DIR, g.id);
    const stats = generator.generate(taskDir);

    // ⭐ 冒烟测试：生成的代码必须能被 node 加载。
    //   几十个文件靠肉眼检查语法是不可能的事 —— 之前就因为一个 handler
    //   叫 "return"（保留字）炸过一次。
    let smoke = '未配置';
    if (generator.smoke) {
      try {
        execFileSync(
          process.execPath,
          ['-e', 'require(' + JSON.stringify(path.join(taskDir, 'initial', generator.smoke)) + ')'],
          { cwd: taskDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 },
        );
        smoke = '✅ 可加载';
      } catch (e) {
        smoke = '❌ 加载失败：' + String(e.stderr || e.message).split('\n').slice(0, 6).join(' | ');
      }
    }

    console.log(
      `  ${g.id.padEnd(32)} ${String(stats.files).padStart(3)} 个文件  ` +
        `${String(stats.dirs).padStart(2)} 个目录  ${String(stats.lines).padStart(5)} 行  ${smoke}`,
    );
  }

  console.log('');
}

main(process.argv);
