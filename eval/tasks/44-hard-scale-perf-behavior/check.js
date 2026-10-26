/**
 * 验收脚本 —— 44-hard-scale-perf-behavior
 *
 * ⭐ 本题的核心是【差分对拍】（differential testing）：
 *
 *   评测侧冻结了一份原始实现（frozen/，agent 看不到），
 *   把它跟沙箱里的实现放到【同一个进程】里对跑，
 *   逐个输入比较输出，要求完全一致。
 *
 *   为什么不用"手写几个期望值"？
 *     手写期望值只能覆盖你想得到的那几个角落，
 *     agent 在你没覆盖的分支上改了行为，你根本发现不了。
 *     冻结参考实现 = 把【全部】行为都锁死，一个字节都不放过。
 *
 * ⭐ 性能断言用【相对倍数】而不是绝对毫秒数：
 *   原始实现和 agent 的实现在同一个进程里对跑，
 *   所以"快 4 倍"这个结论跟机器快慢无关 —— 换台慢机器，比例不变。
 *
 * 判定方式：全部二值断言，不依赖 LLM 打分。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

/** 评测侧冻结的原始实现（跟沙箱无关） */
const FROZEN_DIR = path.join(__dirname, 'frozen');

/** 待清理的临时目录 */
const cleanupDirs = [];
process.on('exit', () => {
  for (const d of cleanupDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* 清理失败不致命 */
    }
  }
});

/**
 * 造一个"参考环境"：冻结的 analyzer + 冻结的 deps
 *
 * ⚠️ 目录结构跟沙箱一致（deps 在下一层，用 '../analyzer' 引用），
 *    这样冻结版 deps 才能加载到冻结版 analyzer。
 *
 * ⚠️ 必须放在系统临时目录里，不能放沙箱里 ——
 *    eval/runner.ts 的 listFiles() 会把沙箱里所有文件算成"agent 改了哪些文件"，
 *    参考产物落在沙箱里会被误判成 agent 的改动 → 污染 L4 回归检测。
 */
function buildReference() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frozen44-'));
  cleanupDirs.push(tmp);
  fs.copyFileSync(path.join(FROZEN_DIR, 'analyzer.js'), path.join(tmp, 'analyzer.js'));
  fs.cpSync(path.join(FROZEN_DIR, 'deps'), path.join(tmp, 'deps'), { recursive: true });
  return tmp;
}

/** 加载沙箱里的 analyzer（每次清缓存，保证读到的是最新代码） */
function loadAgent(dir) {
  const p = path.join(dir, 'src', 'analyzer.js');
  assert.ok(fs.existsSync(p), '文件不存在：src/analyzer.js');
  delete require.cache[require.resolve(p)];
  return require(p);
}

/** 加载参考实现 */
function loadReference(refDir) {
  const p = path.join(refDir, 'analyzer.js');
  delete require.cache[require.resolve(p)];
  return require(p);
}

/** 加载某个下游模块 */
function loadDep(base, name) {
  const p = path.join(base, 'deps', name);
  delete require.cache[require.resolve(p)];
  return require(p);
}

/** 20 个下游模块 */
const DEPS = [
  'wordfreq.js',
  'hapax.js',
  'sentenceCount.js',
  'syllables.js',
  'readability.js',
  'avgWordLength.js',
  'longestWord.js',
  'charClasses.js',
  'uniqueRatio.js',
  'typeTokenRatio.js',
  'repetition.js',
  'paragraphCount.js',
  'lineStats.js',
  'avgSentenceLength.js',
  'stopwordRatio.js',
  'keywordDensity.js',
  'codeBlockCount.js',
  'linkCount.js',
  'markdownHeaderCount.js',
  'emojiCount.js',
];

/**
 * 对拍输入矩阵
 *
 * ⚠️ 顺序是故意设计的：
 *   · 同一个文本配【不同的 options.limit】紧挨着放
 *     → 缓存的 key 只用文本的实现会立刻串味
 *   · 中间放了一次【完全相同】的重复组合
 *     → 验证"内容相同的结果应该命中缓存"
 */
const CASES = [
  { label: '普通英文段落', text: 'The quick brown fox jumps over the lazy dog. It was cold.' },
  {
    label: '缩写不切句',
    text: 'Dr. Smith went to Washington. He met Mr. Jones at 3 p.m. Then he left e.g. early.',
  },
  { label: '中文', text: '这是一段中文文本，里面有标点。还有第二句话！' },
  { label: 'emoji', text: 'Hello 🎉 world 🚀! Done 🎊.' },
  { label: '空串', text: '' },
  { label: '纯空白', text: '   \n\n\t  ' },
  {
    label: 'markdown',
    text: '# Title\n\nSome *text* with [a link](http://x.com).\n\n```js\nconst a = 1;\n```\n\n## Sub',
  },
  { label: '只有一个词', text: 'hello' },
  { label: '标点堆', text: '!!!???...,,,;;;' },
  { label: '数字', text: '2024 was 33% better than 1999 (12.5% growth).' },
  { label: '重复词', text: 'word word word word word word word word word word' },
  { label: '混合大小写', text: 'The THE the ThE tHe' },
  { label: '换行归一化', text: 'a\r\nb\r\n\r\n\r\nc' },
  { label: '长段落', text: 'lorem ipsum dolor sit amet '.repeat(120) },
];

/** options 组合 */
const OPTION_SETS = [
  { label: '无 options', opts: undefined },
  { label: 'limit=5', opts: { limit: 5 } },
  { label: 'limit=200', opts: { limit: 200 } },
];

/**
 * 批量调用的对拍序列
 *
 * ⚠️ 前两组的文本完全一样，只有 options 不同 ——
 *   只按文本做缓存的实现会把第一组的结果发给第二组。
 */
const BATCH_SEQ = [
  { texts: ['alpha beta gamma', 'delta epsilon'], opts: undefined },
  { texts: ['alpha beta gamma', 'delta epsilon'], opts: { limit: 2 } },
  { texts: ['alpha beta gamma', 'delta epsilon'], opts: { limit: 50 } },
  { texts: ['alpha beta gamma', 'delta epsilon'], opts: undefined },
  { texts: ['zeta'], opts: { limit: 1 } },
  { texts: ['zeta'], opts: undefined },
];

/**
 * 性能对跑的负载：8 篇互不相同的文档（缓存不可能命中）
 *
 * ⚠️ 每篇 2400 个 token —— 这个规模下原始实现的 O(n²) 词频统计
 *   占了总耗时的 85%，"把热路径改成 O(n)" 才是有意义的提速。
 *   规模太小的话，固定开销会把倍数稀释掉，测出来的东西没有意义。
 *
 * ⚠️ 文档数量只影响【绝对耗时】，不影响【倍数】——
 *   倍数只跟每篇的 token 数有关（O(n²) 的占比）。
 */
const PERF_WORDS =
  'the quick brown fox jumps over the lazy dog and then runs away into the deep dark forest where nobody goes'.split(
    ' ',
  );

function makePerfText(i) {
  const parts = [];
  for (let k = 0; k < 1200; k++) {
    parts.push(PERF_WORDS[(i * 7 + k * 13) % PERF_WORDS.length]);
    parts.push(String((i * 31 + k) % 97));
  }
  return parts.join(' ');
}

const PERF_TEXTS = [];
for (let i = 0; i < 8; i++) PERF_TEXTS.push(makePerfText(i));

/** 计时（毫秒） */
function timeMs(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

/**
 * A/B 对跑计时
 *
 * ⚠️ 为什么必须【交替】跑、而不是各跑各的：
 *   同一份代码连续跑两遍，第二遍会因为堆更满、GC 更频繁而明显变慢
 *   （实测能差 1.7 倍 —— 那不是实现的差异，是测量顺序的偏差）。
 *   所以每一轮都交替测量两边，再各自取最小值。
 *
 * ⚠️ 为什么取【最小值】而不是平均值：
 *   平均值会被 GC 尖峰拉高，而最小值代表"没有意外干扰时的真实速度"。
 */
function compareSpeed(refFn, agentFn, rounds) {
  // 预热：把 JIT 编译时间排除在测量之外
  refFn();
  agentFn();

  let refMs = Infinity;
  let agentMs = Infinity;

  for (let r = 0; r < rounds; r++) {
    if (r % 2 === 0) {
      agentMs = Math.min(agentMs, timeMs(agentFn));
      refMs = Math.min(refMs, timeMs(refFn));
    } else {
      refMs = Math.min(refMs, timeMs(refFn));
      agentMs = Math.min(agentMs, timeMs(agentFn));
    }
  }

  return { refMs, agentMs };
}

module.exports = {
  taskId: '44-hard-scale-perf-behavior',

  cases: [
    // ═══ 本题目标（baseline 挂 → after 过）═══
    {
      name: '⭐⭐⭐ 性能：跟原始实现对跑，快至少 4 倍',
      fn: ({ dir }) => {
        const refDir = buildReference();
        const ref = loadReference(refDir);
        const agent = loadAgent(dir);

        const { refMs, agentMs } = compareSpeed(
          () => ref.analyzeBatch(PERF_TEXTS),
          () => agent.analyzeBatch(PERF_TEXTS),
          4,
        );

        assert.ok(
          agentMs * 4 < refMs,
          `性能不达标：你的实现 ${agentMs.toFixed(1)}ms，原始实现 ${refMs.toFixed(1)}ms，` +
            `只快了 ${(refMs / Math.max(agentMs, 0.001)).toFixed(2)} 倍（要求 ≥ 4 倍）\n` +
            `  提示：热点在词频统计（原始实现是 O(n²) 的朴素计数）`,
        );
      },
    },
    {
      name: '⭐⭐⭐ 行为：analyze() 的输出跟原始实现逐字一致（差分对拍）',
      fn: ({ dir }) => {
        const refDir = buildReference();
        const ref = loadReference(refDir);
        const agent = loadAgent(dir);

        for (const c of CASES) {
          for (const o of OPTION_SETS) {
            const expected = ref.analyze(c.text, o.opts);
            const actual = agent.analyze(c.text, o.opts);
            try {
              assert.deepStrictEqual(actual, expected);
            } catch {
              throw new Error(
                `输出不一致：\n` +
                  `  输入   = ${c.label}（${o.label}）\n` +
                  `  文本   = ${JSON.stringify(c.text).slice(0, 120)}\n` +
                  `  期望   = ${JSON.stringify(expected).slice(0, 600)}\n` +
                  `  实际   = ${JSON.stringify(actual).slice(0, 600)}\n` +
                  `  ⚠️ 性能优化【不允许改变任何一个结果】`,
              );
            }
          }
        }
      },
    },
    {
      name: '⭐⭐⭐ 行为：analyzeBatch() 的结果跟原始实现逐字一致（含缓存串味检查）',
      fn: ({ dir }) => {
        const refDir = buildReference();
        const ref = loadReference(refDir);
        const agent = loadAgent(dir);

        for (let i = 0; i < BATCH_SEQ.length; i++) {
          const s = BATCH_SEQ[i];
          const expected = ref.analyzeBatch(s.texts, s.opts);
          const actual = agent.analyzeBatch(s.texts, s.opts);
          try {
            assert.deepStrictEqual(actual, expected);
          } catch {
            throw new Error(
              `第 ${i + 1} 组批量调用结果不一致：\n` +
                `  texts  = ${JSON.stringify(s.texts)}\n` +
                `  opts   = ${JSON.stringify(s.opts)}\n` +
                `  期望   = ${JSON.stringify(expected).slice(0, 600)}\n` +
                `  实际   = ${JSON.stringify(actual).slice(0, 600)}\n` +
                `  ⚠️ 如果你加了缓存：key 必须覆盖【所有会影响结果的输入】，不只是文本`,
            );
          }
        }
      },
    },
    {
      name: '⭐⭐⭐ 20 个下游模块的输出跟原始实现逐字一致',
      fn: ({ dir }) => {
        const refDir = buildReference();
        const ref = loadReference(refDir);
        const agent = loadAgent(dir);

        const probeTexts = [
          'The quick brown fox jumps over the lazy dog. Dr. Smith was there.',
          'Hello 世界 🎉 with 123 numbers and [a link](http://x.com).',
          '# Head\n\n```js\nconst a = 1;\n```\n\n- item one\n- item two',
        ];

        for (const name of DEPS) {
          const refDep = loadDep(refDir, name);
          const realDep = loadDep(path.join(dir, 'src'), name);
          for (const t of probeTexts) {
            const expected = refDep.derive(t);
            const actual = realDep.derive(t);
            try {
              assert.deepStrictEqual(actual, expected);
            } catch {
              throw new Error(
                `下游模块 ${name} 的输出变了：\n` +
                  `  文本 = ${JSON.stringify(t).slice(0, 120)}\n` +
                  `  期望 = ${JSON.stringify(expected).slice(0, 400)}\n` +
                  `  实际 = ${JSON.stringify(actual).slice(0, 400)}\n` +
                  `  ⚠️ 这些下游模块依赖的是 analyzer【当前】的行为 —— 一个字节都不许变`,
              );
            }
          }
        }
      },
    },

    // ═══ 回归守卫（baseline 必须通过）═══
    {
      name: '回归守卫：20 个下游模块的文件一个字节都没改',
      fn: ({ dir }) => {
        const changed = [];
        for (const name of DEPS) {
          const sandboxFile = path.join(dir, 'src', 'deps', name);
          const frozenFile = path.join(FROZEN_DIR, 'deps', name);
          assert.ok(fs.existsSync(sandboxFile), `下游模块不见了：src/deps/${name}`);
          const a = fs.readFileSync(sandboxFile);
          const b = fs.readFileSync(frozenFile);
          if (!a.equals(b)) changed.push(`src/deps/${name}`);
        }
        assert.strictEqual(
          changed.length,
          0,
          `这 ${changed.length} 个下游模块被改了：\n  - ${changed.join('\n  - ')}\n` +
            `  ⚠️ 下游模块是【被依赖方】，本题只许改 analyzer`,
        );
      },
    },
    {
      name: '回归守卫：analyzer 的导出集合没变',
      fn: ({ dir }) => {
        const refDir = buildReference();
        const ref = loadReference(refDir);
        const agent = loadAgent(dir);
        assert.deepStrictEqual(
          Object.keys(agent).sort(),
          Object.keys(ref).sort(),
          'analyzer 的导出集合变了 —— 下游模块按名字取函数，删了就跑不起来',
        );
      },
    },
    {
      name: '回归守卫：仓库自带的 test/run-all.js 仍然全部通过',
      fn: ({ dir }) => {
        const testFile = path.join(dir, 'test', 'run-all.js');
        assert.ok(fs.existsSync(testFile), 'test/run-all.js 不见了');
        try {
          execFileSync(process.execPath, [testFile], {
            cwd: dir,
            encoding: 'utf-8',
            timeout: 120000,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch (e) {
          const output = `${e.stdout || ''}${e.stderr || ''}`;
          throw new Error(
            `test/run-all.js 跑挂了：\n${output.slice(0, 2000)}\n` +
              `  ⚠️ 这张回归网覆盖不全，但挂了说明肯定改坏了东西`,
          );
        }
      },
    },
    {
      name: '回归守卫：test/ 目录一个字节都没改',
      fn: ({ dir }) => {
        const testDir = path.join(dir, 'test');
        const files = fs.readdirSync(testDir);
        assert.ok(files.includes('run-all.js'), 'test/run-all.js 不见了');
        for (const f of files) {
          const sandboxFile = path.join(testDir, f);
          const frozenFile = path.join(FROZEN_DIR, 'test', f);
          if (!fs.existsSync(frozenFile)) continue;
          assert.ok(
            fs.readFileSync(sandboxFile).equals(fs.readFileSync(frozenFile)),
            `test/${f} 被改了 —— 不许改测试的期望值`,
          );
        }
      },
    },
  ],
};
