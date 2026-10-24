/**
 * 验收脚本 —— 真实 TypeScript 构建题
 *
 * ⭐ 本题的核心：真的跑一遍 `tsc --noEmit`。
 *
 *   为什么必须真跑：
 *     真实项目里，类型错误和运行时错误是两回事。
 *     类型错误往往到 CI 才暴露 —— 而 CI 挂了的时候，
 *     没人知道是「类型写错了」还是「逻辑写错了」。
 *
 *   断言方式：跑 tsc，看退出码。
 *   · 退出码 0 → 没有类型错误 ✓
 *   · 退出码非 0 → 还有类型错误 ✗（把 stderr 附在错误信息里）
 *
 * ⚠️ 一个必须处理的问题：tsc 从哪来？
 *   沙箱里没有 node_modules，tsc 也不在沙箱里。
 *   所以这里用「项目根的 node_modules/.bin/tsc」——
 *   也就是评测框架自己所在项目的 tsc。
 *   这是合理的：题目考的是「会不会用类型系统」，不是「会不会装依赖」。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

/** 找到可用的 tsc */
function findTsc() {
  // 1) 项目根的 node_modules/.bin/tsc（Windows 下是 .cmd）
  const candidates = [];

  // 沙箱路径形如 C:\Users\X\AppData\Local\Temp\minicoder-eval-31-xxx
  // 往上找几层找到仓库根
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, 'node_modules', '.bin', 'tsc');
    if (fs.existsSync(p + '.cmd')) {
      candidates.push(p + '.cmd');
      candidates.push(p);
      break;
    }
    if (fs.existsSync(p)) {
      candidates.push(p);
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2) 系统 PATH 里的 tsc
  candidates.push('tsc');

  return candidates;
}

/**
 * 跑 tsc --noEmit，返回 { ok, output }
 */
function runTsc(dir) {
  const tsc = findTsc();
  let lastError = '';

  for (const candidate of tsc) {
    try {
      const out = execFileSync(
        candidate,
        ['--noEmit', '-p', path.join(dir, 'tsconfig.json')],
        {
          cwd: dir,
          encoding: 'utf-8',
          timeout: 120_000,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: candidate.endsWith('.cmd'),
        },
      );
      return { ok: true, output: out || '' };
    } catch (e) {
      const output = `${e.stdout || ''}${e.stderr || ''}`;
      // 「找不到命令」类的错误 → 试下一个候选
      if (/ENOENT|not found|不是内部或外部命令|Command not found/i.test(output + e.message)) {
        lastError = output || e.message;
        continue;
      }
      // 真的编译失败 → 返回失败（这就是我们要的）
      return { ok: false, output: output || String(e.message) };
    }
  }

  // 所有候选都找不到 tsc → 报错（这属于评测基础设施问题）
  throw new Error(`找不到 tsc 可执行文件。试过：${tsc.join(', ')}。${lastError}`);
}

/**
 * 编译并执行 TS 文件，拿到导出
 *
 * 办法：用 tsc 把 TS 编译成 JS 到临时目录，再用 node 加载。
 * 这样断言的是【真实运行行为】，不是【源码文本】。
 */
function compileAndLoad(dir, entryFile) {
  // ⚠️ 编译产物必须放到【沙箱外】！
  //   eval/runner.ts 的 listFiles() 会把沙箱里所有文件算成"agent 改了哪些文件"，
  //   编译产物如果落在沙箱里，就会被误判成 agent 的改动 → 污染 L4 回归检测。
  //   （这跟沙箱里要关掉 checkpoint 是同一个理由）
  const outDir = path.join(
    require('os').tmpdir(),
    `minicoder-tsc-${path.basename(dir)}-${Date.now()}`,
  );

  const tsc = findTsc();
  let compiled = false;
  let lastErr = '';

  // ⚠️ 必须把 globals.d.ts 一起编译进来 ——
  //   否则 require / module / process 会报 TS2580（找不到 Node 全局类型）。
  //   单独编译单个入口文件时，tsc 不会自动带上 tsconfig 里的 include。
  const globalsPath = path.join(dir, 'globals.d.ts');
  const fileArgs = [path.join(dir, entryFile)];
  if (fs.existsSync(globalsPath)) fileArgs.push(globalsPath);

  for (const candidate of tsc) {
    try {
      execFileSync(
        candidate,
        [
          '--outDir', outDir,
          '--module', 'commonjs',
          '--target', 'ES2020',
          '--esModuleInterop',
          '--skipLibCheck',
          '--strict',
          ...fileArgs,
        ],
        {
          cwd: dir,
          encoding: 'utf-8',
          timeout: 120_000,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: candidate.endsWith('.cmd'),
        },
      );
      compiled = true;
      break;
    } catch (e) {
      const output = `${e.stdout || ''}${e.stderr || ''}`;
      if (/ENOENT|not found|不是内部或外部命令|Command not found/i.test(output + e.message)) {
        lastErr = output || e.message;
        continue;
      }
      throw new Error(`编译 ${entryFile} 失败：\n${output}`);
    }
  }

  if (!compiled) {
    throw new Error(`找不到 tsc 可执行文件。试过：${tsc.join(', ')}。${lastErr}`);
  }

  const jsPath = path.join(outDir, entryFile.replace(/\.ts$/, '.js'));
  delete require.cache[require.resolve(jsPath)];
  const mod = require(jsPath);

  // 记下编译目录，等所有 case 跑完再清理
  registerCleanup(outDir);

  return mod;
}

/** 待清理的编译目录 */
const cleanupDirs = [];

function registerCleanup(dir) {
  if (!cleanupDirs.includes(dir)) cleanupDirs.push(dir);
}

/**
 * 清理编译产物
 *
 * 为什么要清理：
 *   编译目录在系统临时目录里，不在沙箱里（不污染 L4 回归检测），
 *   但跑完题还是该删掉 —— 不然临时目录会越积越多。
 */
function cleanupAll() {
  for (const d of cleanupDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* 清理失败不致命 */
    }
  }
  cleanupDirs.length = 0;
}

// 模块被加载时注册退出钩子
process.on('exit', cleanupAll);

/** 读取 tsconfig 的关键配置，验证没被放宽 */
function readTsconfig(dir) {
  const p = path.join(dir, 'tsconfig.json');
  const raw = fs.readFileSync(p, 'utf-8');
  // 去掉注释后 parse
  const noComments = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  try {
    return JSON.parse(noComments);
  } catch {
    return null;
  }
}

module.exports = {
  taskId: '31-hard-real-tsc-build',

  cases: [
    // ═══ 本题目标（baseline 挂）═══
    {
      name: '⭐⭐ tsc --noEmit 干净通过（真的跑一遍编译器）',
      fn: ({ dir }) => {
        const result = runTsc(dir);
        assert.ok(
          result.ok,
          `tsc 报错了：\n${result.output}\n\n` +
            `提示：不要用 any / @ts-ignore 糊过去，也别改 tsconfig.json。`,
        );
      },
    },
    {
      name: '⭐ formatUser 支持 compact 风格且输出正确',
      fn: ({ dir }) => {
        const mod = compileAndLoad(dir, 'format.ts');
        assert.strictEqual(typeof mod.formatUser, 'function', 'formatUser 未导出');

        const users = [
          { id: 1, name: 'Ada', age: 36, tags: ['x'] },
          { id: 2, name: 'Lin', age: 28, tags: ['y'] },
        ];

        // compact 格式： "Ada(36), Lin(28)"
        const out = mod.formatUser(users, 'compact');
        assert.strictEqual(
          out,
          'Ada(36), Lin(28)',
          `compact 输出不对，实际：\n${JSON.stringify(out)}`,
        );
      },
    },
    {
      name: '⭐ compact 风格空数组返回空字符串',
      fn: ({ dir }) => {
        const mod = compileAndLoad(dir, 'format.ts');
        const out = mod.formatUser([], 'compact');
        assert.strictEqual(out, '', `空数组应返回空串，实际：${JSON.stringify(out)}`);
      },
    },
    {
      name: '⭐ CLI 能解析 --format compact',
      fn: ({ dir }) => {
        const mod = compileAndLoad(dir, 'cli.ts');
        assert.strictEqual(typeof mod.parseFormat, 'function', 'parseFormat 未导出');
        assert.strictEqual(
          mod.parseFormat('compact'),
          'compact',
          `parseFormat('compact') 应返回 'compact'`,
        );
      },
    },
    {
      name: '⭐ CLI 跑 --format compact 输出正确',
      fn: ({ dir }) => {
        const mod = compileAndLoad(dir, 'cli.ts');
        const out = mod.run(['--format', 'compact']);
        assert.ok(
          out.includes('Ada(36)') && out.includes('Lin(28)'),
          `CLI compact 输出不对：\n${out}`,
        );
        assert.ok(out.includes(', '), `多个用户应该用 ", " 分隔：\n${out}`);
      },
    },

    // ═══ 回归守卫（baseline 必须通过）═══
    {
      name: '回归守卫：full 格式输出没变',
      fn: ({ dir }) => {
        const mod = compileAndLoad(dir, 'format.ts');
        const users = [
          { id: 1, name: 'Ada', age: 36, tags: ['x'] },
          { id: 2, name: 'Lin', age: 28, tags: ['y'] },
        ];
        const out = mod.formatUser(users, 'full');
        assert.ok(out.includes('Ada (36岁'), `full 格式被改坏了：\n${out}`);
        assert.ok(out.includes('Lin (28岁'), `full 格式被改坏了：\n${out}`);
      },
    },
    {
      name: '回归守卫：short 格式输出没变',
      fn: ({ dir }) => {
        const mod = compileAndLoad(dir, 'format.ts');
        const users = [{ id: 1, name: 'Ada', age: 36, tags: ['x'] }];
        const out = mod.formatUser(users, 'short');
        assert.strictEqual(out, 'Ada(36)', `short 格式被改坏了：${JSON.stringify(out)}`);
      },
    },
    {
      name: '回归守卫：默认风格是 full',
      fn: ({ dir }) => {
        const mod = compileAndLoad(dir, 'format.ts');
        const users = [{ id: 1, name: 'Ada', age: 36, tags: ['x'] }];
        const out = mod.formatUser(users);
        assert.ok(out.includes('岁'), `默认风格应为 full，实际：${out}`);
      },
    },
    {
      name: '回归守卫：formatCompact 函数还在且行为正确',
      fn: ({ dir }) => {
        const mod = compileAndLoad(dir, 'format.ts');
        assert.strictEqual(typeof mod.formatCompact, 'function', 'formatCompact 未导出');
        const out = mod.formatCompact([
          { id: 1, name: 'Ada', age: 36, tags: [] },
          { id: 2, name: 'Lin', age: 28, tags: [] },
        ]);
        assert.strictEqual(out, 'Ada(36), Lin(28)', `formatCompact 输出不对：${out}`);
      },
    },
    {
      name: '⭐⭐ 类型信息没被削弱（没有 any / ts-ignore 糊弄）',
      fn: ({ dir }) => {
        const files = ['types.ts', 'format.ts', 'cli.ts'];
        for (const f of files) {
          const src = fs.readFileSync(path.join(dir, f), 'utf-8');
          assert.ok(
            !/@ts-ignore|@ts-nocheck/.test(src),
            `${f} 里用了 @ts-ignore / @ts-nocheck —— 这是把编译器关掉，不是修类型错误`,
          );
          // 检查有没有把类型写成 any（排除注释里的 any）
          const code = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
          assert.ok(
            !/:\s*any\b/.test(code),
            `${f} 里把类型写成了 any —— 类型系统被削弱了`,
          );
          assert.ok(
            !/as\s+any\b/.test(code),
            `${f} 里用了 as any —— 类型系统被削弱了`,
          );
        }
      },
    },
    {
      name: '⭐⭐ tsconfig 的严格配置没被放宽',
      fn: ({ dir }) => {
        const cfg = readTsconfig(dir);
        assert.ok(cfg, 'tsconfig.json 解析失败');
        const opts = cfg.compilerOptions || {};
        assert.strictEqual(opts.strict, true, 'tsconfig 的 strict 被关掉了');
        assert.strictEqual(
          opts.noImplicitAny,
          true,
          'tsconfig 的 noImplicitAny 被关掉了',
        );
        assert.ok(
          opts.noEmit !== false,
          'tsconfig 的 noEmit 被改成了 false',
        );
      },
    },
    {
      name: '回归守卫：User 接口的字段没被删',
      fn: ({ dir }) => {
        const src = fs.readFileSync(path.join(dir, 'types.ts'), 'utf-8');
        for (const field of ['id', 'name', 'age', 'tags']) {
          assert.ok(
            new RegExp(`\\b${field}\\s*:`).test(src),
            `User 接口的 ${field} 字段没了`,
          );
        }
      },
    },
  ],
};
