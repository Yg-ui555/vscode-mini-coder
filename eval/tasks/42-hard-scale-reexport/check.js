/**
 * 验收脚本 —— 42-hard-scale-reexport
 *
 * ⭐ 本题的核心是【改对层】：
 *
 *   4 个对外入口的来源链不一样：
 *     api/index → public/index → internal/index → core/string   ✅ 本来就对
 *     api/http  → public/http  → internal/http  → core/string   ❌ 被覆盖
 *     api/cli   → public/cli   → internal/index → core/string   ❌ 被覆盖
 *     api/feed  → public/feed  → internal/index → core/string   ❌ 被覆盖
 *
 *   所以：
 *     · 只改 core 里的实现 → 对 3 个坏入口一点用都没有
 *     · 只改覆盖源头（core/legacy） → 3 个入口全好了，
 *       但依赖老语义的那几条内部链路的输出也变了 → 回归
 *
 * 判定方式：全部二值断言，不依赖 LLM 打分。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

/** 加载沙箱里的模块（每次清缓存，保证读到的是最新代码） */
function loadMod(dir, rel) {
  const p = path.join(dir, rel);
  assert.ok(fs.existsSync(p), `文件不存在：${rel}`);
  delete require.cache[require.resolve(p)];
  return require(p);
}

/** 4 个对外入口 */
const ENTRIES = [
  { file: 'src/api/index.js', label: 'api/index' },
  { file: 'src/api/http.js', label: 'api/http' },
  { file: 'src/api/cli.js', label: 'api/cli' },
  { file: 'src/api/feed.js', label: 'api/feed' },
];

/** 规范要求的截断行为 */
function expectedTruncate(text, max) {
  const s = String(text);
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

/** 三组探针输入：ASCII / 多字节 / 不超长 */
const PROBES = [
  { text: 'hello world', max: 5, label: 'ASCII 截断' },
  { text: '你好世界', max: 2, label: '多字节截断（必须按字符，不能按字节）' },
  { text: 'hi', max: 10, label: '不超长' },
];

/** 检查一个入口的 truncate 是否符合规范 */
function assertEntryTruncate(dir, entry) {
  const mod = loadMod(dir, entry.file);
  assert.strictEqual(typeof mod.truncate, 'function', `${entry.label} 没有导出 truncate`);

  const wrong = [];
  for (const p of PROBES) {
    let actual;
    try {
      actual = mod.truncate(p.text, p.max);
    } catch (e) {
      wrong.push(`${p.label}：抛异常了（${e.message}）`);
      continue;
    }
    const expected = expectedTruncate(p.text, p.max);
    if (actual !== expected) {
      wrong.push(
        `${p.label}：truncate(${JSON.stringify(p.text)}, ${p.max})\n` +
          `        实际 = ${JSON.stringify(actual)}\n` +
          `        期望 = ${JSON.stringify(expected)}`,
      );
    }
  }
  assert.strictEqual(
    wrong.length,
    0,
    `${entry.label} 的 truncate 不符合规范（${wrong.length} 处不对）：\n  - ${wrong.join('\n  - ')}\n` +
      `  规范：按【字符】截断，超长时补一个省略号 "…"\n` +
      `  ⚠️ 老行为是按字节截断 + 三个点 "..."，多字节字符还会被切坏`,
  );
}

/**
 * 依赖老截断语义的内部链路 —— 输出必须一个字节都不变
 *
 * ⚠️ 这三条链路是本题的回归锚点：
 *   直接改覆盖源头（core/legacy）的话，它们会跟着变 → 判 regressed。
 *
 *   width 是各自的老截断宽度（照着它们各自调用时的参数写的）。
 */
const LEGACY_CONSUMERS = [
  {
    file: 'src/features/httpPreview.js',
    fn: 'preview',
    arg: 'x'.repeat(50),
    width: 40,
    wrap: (s) => s,
    label: '预览条',
  },
  {
    file: 'src/widgets/badge.js',
    fn: 'badge',
    arg: 'y'.repeat(20),
    width: 12,
    wrap: (s) => '[' + s + ']',
    label: '徽标',
  },
  {
    file: 'src/features/logline.js',
    fn: 'logline',
    arg: 'z'.repeat(100),
    width: 60,
    wrap: (s) => s,
    label: '日志摘要',
  },
];

module.exports = {
  taskId: '42-hard-scale-reexport',

  cases: [
    // ═══ 本题目标（baseline 挂 → after 过）═══
    {
      name: '⭐⭐ 对外入口 api/http 的 truncate 符合规范',
      fn: ({ dir }) => {
        assertEntryTruncate(dir, ENTRIES[1]);
      },
    },
    {
      name: '⭐⭐ 对外入口 api/cli 的 truncate 符合规范',
      fn: ({ dir }) => {
        assertEntryTruncate(dir, ENTRIES[2]);
      },
    },
    {
      name: '⭐⭐ 对外入口 api/feed 的 truncate 符合规范',
      fn: ({ dir }) => {
        assertEntryTruncate(dir, ENTRIES[3]);
      },
    },
    {
      name: '⭐⭐⭐ 4 个对外入口的 truncate 行为完全一致',
      fn: ({ dir }) => {
        const results = ENTRIES.map((e) => {
          const mod = loadMod(dir, e.file);
          return PROBES.map((p) => {
            try {
              return mod.truncate(p.text, p.max);
            } catch (err) {
              return `THROW:${err.message}`;
            }
          });
        });
        const first = results[0];
        const bad = [];
        for (let i = 1; i < results.length; i++) {
          if (JSON.stringify(results[i]) !== JSON.stringify(first)) {
            bad.push(
              `${ENTRIES[i].label} = ${JSON.stringify(results[i])}\n` +
                `        ${ENTRIES[0].label} = ${JSON.stringify(first)}`,
            );
          }
        }
        assert.strictEqual(
          bad.length,
          0,
          `4 个对外入口的 truncate 行为不一致：\n  - ${bad.join('\n  - ')}\n` +
            `  ⚠️ 这个仓库是分层的，不同入口的来源链不一样 —— 别只改一个地方`,
        );
      },
    },

    // ═══ 回归守卫（baseline 必须通过）═══
    {
      name: '回归守卫：对外入口 api/index 的 truncate 行为没被改坏',
      fn: ({ dir }) => {
        assertEntryTruncate(dir, ENTRIES[0]);
      },
    },
    {
      name: '⭐⭐⭐ 依赖老截断语义的三条内部链路，输出一个字节都没变',
      fn: ({ dir }) => {
        const wrong = [];
        for (const c of LEGACY_CONSUMERS) {
          const mod = loadMod(dir, c.file);
          if (typeof mod[c.fn] !== 'function') {
            wrong.push(`${c.file}：没有导出 ${c.fn}`);
            continue;
          }
          let actual;
          try {
            actual = mod[c.fn](c.arg);
          } catch (e) {
            wrong.push(`${c.label}（${c.file}）：抛异常了（${e.message}）`);
            continue;
          }
          // 老语义：按字节截断 + 三个点
          const expected = c.wrap(c.arg.slice(0, c.width) + '...');
          if (actual !== expected) {
            wrong.push(
              `${c.label}（${c.file}）：\n        实际 = ${JSON.stringify(actual)}\n` +
                `        期望 = ${JSON.stringify(expected)}`,
            );
          }
        }
        assert.strictEqual(
          wrong.length,
          0,
          `${wrong.length} 条内部老链路的输出变了：\n  - ${wrong.join('\n  - ')}\n` +
            `  ⚠️ 这些链路依赖的是老的字节级截断语义 —— 本题只要求改对外入口`,
        );
      },
    },
    {
      name: '回归守卫：4 个入口的其它导出没变',
      fn: ({ dir }) => {
        for (const e of ENTRIES) {
          const mod = loadMod(dir, e.file);
          assert.strictEqual(
            mod.formatBytes(1536),
            '1.5 KB',
            `${e.label} 的 formatBytes 被改动了`,
          );
          assert.strictEqual(
            mod.slugify('Hello World'),
            'hello-world',
            `${e.label} 的 slugify 被改动了`,
          );
          assert.deepStrictEqual(
            mod.parseRange('1-10'),
            [1, 10],
            `${e.label} 的 parseRange 被改动了`,
          );
          assert.strictEqual(mod.clamp(5, 0, 3), 3, `${e.label} 的 clamp 被改动了`);
        }
      },
    },
    {
      name: '回归守卫：4 个入口的关键导出都还在',
      fn: ({ dir }) => {
        const KEY = [
          'truncate',
          'padStart',
          'slugify',
          'capitalize',
          'trim',
          'repeat',
          'formatBytes',
          'clamp',
          'parseRange',
          'roundTo',
          'isInteger',
          'toPercent',
        ];
        for (const e of ENTRIES) {
          const mod = loadMod(dir, e.file);
          for (const k of KEY) {
            assert.strictEqual(
              typeof mod[k],
              'function',
              `${e.label} 的 ${k} 没了（转发关系被拆掉了？）`,
            );
          }
        }
      },
    },
  ],
};
