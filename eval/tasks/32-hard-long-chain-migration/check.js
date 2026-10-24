/**
 * 验收脚本 —— 长链条异步迁移题
 *
 * ⭐ 本题考的不是"会不会写 async"，
 *   而是【能不能把一个基础函数的签名变更，安全地传导到整个调用链上】。
 *
 * 陷阱设计（每一个都对应一种真实事故）：
 *   1. 只 grep "require('./config')" → 漏掉从 loader 重新导出拿 readConfig 的那一处
 *   2. 只改 import 不改调用 → readConfig 变成 Promise，config.name 全是 undefined
 *   3. 把 startServer 改成 async → 现有调用方拿不到 server 对象，公共 API 被破坏
 *   4. 改掉 processTask / bootstrap 的回调签名 → 现有调用方直接崩
 *   5. 顶层调用没包 .catch → 未捕获的 Promise rejection，进程非 0 退出
 *
 * ⚠️ 为什么本题的"目标"只有一个，断言却那么多：
 *   目标只有一个 —— readConfig 变成异步。
 *   但【只做这一件事是不够的】：
 *   漏改任何一处调用方，原本绿的测试就会红 → 在评测框架里表现为【回归】，
 *   比"没改对"更严重（verdict = regressed）。
 *   所以每个调用方都有独立的行为断言 —— 漏一处就红一处。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

/** 一个肯定不存在的配置路径（用来测"读不到文件"的分支） */
const MISSING_CONFIG = path.join(os.tmpdir(), 'minicoder-definitely-missing-config.json');

/** 读沙箱里的文件 */
function readSrc(dir, rel) {
  const p = path.join(dir, rel);
  assert.ok(fs.existsSync(p), `文件不存在：${rel}`);
  return fs.readFileSync(p, 'utf-8');
}

/** 加载沙箱里的模块（每次都清缓存，保证读到的是最新代码） */
function loadMod(dir, rel) {
  const p = path.join(dir, rel);
  assert.ok(fs.existsSync(p), `文件不存在：${rel}`);
  delete require.cache[require.resolve(p)];
  return require(p);
}

/** 写一个临时配置文件（放在沙箱外，避免污染 L4 的"agent 改了哪些文件"） */
function writeTempConfig(content) {
  const p = path.join(
    os.tmpdir(),
    `minicoder-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}

function unlinkQuiet(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    /* 清理失败不致命 */
  }
}

/**
 * 跑一个 node 子进程
 *
 * 为什么用子进程而不是直接 require：
 *   真实的 CLI / 测试运行器行为（退出码、未捕获异常、顶层 await 缺失）
 *   只有在独立进程里才看得见。
 */
function runNode(cwd, args, timeout = 60_000) {
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd,
      encoding: 'utf-8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout: stdout || '', stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      error: e.message,
    };
  }
}

module.exports = {
  taskId: '32-hard-long-chain-migration',

  cases: [
    // ═══ 本题目标（baseline 挂 → after 过）═══
    {
      name: '⭐⭐ readConfig 已经改成异步（返回 Promise）',
      fn: async ({ dir }) => {
        const { readConfig } = loadMod(dir, 'src/config.js');
        const p = readConfig(MISSING_CONFIG);
        assert.ok(
          p && typeof p.then === 'function',
          'readConfig 必须返回 Promise —— 它现在还是同步的',
        );
        // ⭐ 不能是"挂着配置字段的假 Promise"：
        //   p.port = 3000 这种写法能让不 await 的调用方"看起来能用"，
        //   但那不是异步迁移，是把同步行为伪装成异步。
        assert.ok(
          !Object.prototype.hasOwnProperty.call(p, 'port'),
          'readConfig 返回的对象上直接挂着 port 等字段 —— 那是假 Promise，不是异步迁移',
        );
        const cfg = await p;
        assert.strictEqual(cfg.name, 'app', `解析结果不对：${JSON.stringify(cfg)}`);
        assert.strictEqual(cfg.port, 3000, `解析结果不对：${JSON.stringify(cfg)}`);
      },
    },
    {
      name: '⭐ readConfig 用 async 关键字声明（题目明确要求）',
      fn: ({ dir }) => {
        const { readConfig } = loadMod(dir, 'src/config.js');
        assert.strictEqual(
          readConfig.constructor.name,
          'AsyncFunction',
          'readConfig 应该声明为 async function readConfig(path)',
        );
      },
    },
    {
      name: '⭐⭐ loader.js 正确等待了 readConfig',
      fn: async ({ dir }) => {
        const { loadConfig } = loadMod(dir, 'src/loader.js');
        const cfg = await loadConfig(MISSING_CONFIG);
        assert.strictEqual(
          cfg.name,
          'app',
          `loadConfig 没等到配置就返回了（name=${cfg.name}）—— 是不是漏了 await？`,
        );
        assert.strictEqual(cfg.port, 3000, `port 不对（${cfg.port}）—— 是不是漏了 await？`);
        assert.strictEqual(
          cfg.url,
          'http://app:3000',
          `url 不对（${cfg.url}）—— 说明 config 其实是 Promise，不是配置对象`,
        );
      },
    },
    {
      name: '⭐⭐ server.js 正确等待了 readConfig（回调里）',
      fn: async ({ dir }) => {
        const { startServer } = loadMod(dir, 'src/server.js');
        // ⚠️ startServer 必须【同步】返回 server 对象：
        //    现有调用方拿到返回值就直接 .on(...) / .close(...)，改成 async 就把 API 改了。
        const server = startServer(MISSING_CONFIG);
        assert.ok(
          server && typeof server.on === 'function',
          'startServer 必须同步返回 server 对象（现有调用方要拿它 .on / .close）',
        );
        try {
          const cfg = await new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('3 秒内没有收到 configured 事件')),
              3000,
            );
            server.on('configured', (c) => {
              clearTimeout(timer);
              resolve(c);
            });
          });
          assert.strictEqual(
            cfg.port,
            3000,
            `server 拿到的 config.port 不对（${cfg.port}）—— listen 回调里漏了 await？`,
          );
          assert.strictEqual(cfg.name, 'app', `config.name 不对（${cfg.name}）`);
        } finally {
          try {
            server.close();
          } catch {
            /* 没 listen 上时 close 会抛，忽略 */
          }
        }
      },
    },
    {
      name: '⭐⭐ worker.js 正确等待了 readConfig（定时器回调 + 动态 require）',
      fn: async ({ dir }) => {
        const { processTask } = loadMod(dir, 'src/worker.js');
        const result = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('3 秒内任务没完成')), 3000);
          processTask(MISSING_CONFIG, (r) => {
            clearTimeout(timer);
            resolve(r);
          });
        });
        assert.strictEqual(
          result.port,
          3000,
          `worker 拿到的 port 不对（${result.port}）—— setTimeout 回调里漏了 await？`,
        );
        assert.strictEqual(result.name, 'app', `worker 拿到的 name 不对（${result.name}）`);
      },
    },
    {
      name: '⭐⭐ cli.js 正确等待了 readConfig',
      fn: async ({ dir }) => {
        const { printConfig } = loadMod(dir, 'src/cli.js');
        const out = await printConfig(MISSING_CONFIG);
        assert.strictEqual(typeof out, 'string', 'printConfig 应返回字符串');
        assert.ok(out.includes('name: app'), `输出不对：\n${out}`);
        assert.ok(out.includes('port: 3000'), `输出不对：\n${out}`);
        assert.ok(
          !out.includes('undefined'),
          `输出里出现 undefined —— readConfig 没被 await：\n${out}`,
        );
      },
    },
    {
      name: '⭐⭐ bootstrap.js 正确等待了 readConfig（藏在重新导出后面）',
      fn: async ({ dir }) => {
        const { bootstrap } = loadMod(dir, 'src/bootstrap.js');
        const info = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('3 秒内启动没完成')), 3000);
          bootstrap(MISSING_CONFIG, (r) => {
            clearTimeout(timer);
            resolve(r);
          });
        });
        assert.strictEqual(info.app, 'app', `app 不对（${info.app}）`);
        assert.strictEqual(
          info.port,
          3000,
          `port 不对（${info.port}）—— bootstrap 拿到的 readConfig 是从 loader 重新导出的那一层`,
        );
      },
    },
    {
      name: '⭐⭐ CLI 顶层调用包好了（真跑一下 node src/cli.js）',
      fn: ({ dir }) => {
        // cwd 用一个空目录：避免沙箱里恰好存在的 config.json 影响结果
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'minicoder-cli-cwd-'));
        try {
          const r = runNode(cwd, [path.join(dir, 'src', 'cli.js'), MISSING_CONFIG], 30_000);
          assert.strictEqual(
            r.code,
            0,
            `CLI 退出码 ${r.code}（顶层调用必须包 .catch，否则未捕获的 rejection 会让进程非 0 退出）\n` +
              `stdout: ${r.stdout}\nstderr: ${r.stderr}`,
          );
          assert.ok(
            /name:\s*app/.test(r.stdout),
            `CLI 输出不对：\n${r.stdout}\n${r.stderr}`,
          );
          assert.ok(
            /port:\s*3000/.test(r.stdout),
            `CLI 输出不对：\n${r.stdout}\n${r.stderr}`,
          );
        } finally {
          try {
            fs.rmSync(cwd, { recursive: true, force: true });
          } catch {
            /* 清理失败不致命 */
          }
        }
      },
    },

    // ═══ 回归守卫（baseline 必须通过，after 也必须通过）═══
    {
      name: '⭐⭐⭐ node test/run-all.js 全绿（唯一能证明你改对了的方式）',
      fn: ({ dir }) => {
        const r = runNode(dir, ['test/run-all.js'], 90_000);
        assert.strictEqual(
          r.code,
          0,
          `测试没全绿（退出码 ${r.code}）：\n${r.stdout}\n${r.stderr}`,
        );
        assert.ok(
          /失败\s*0\s*个/.test(r.stdout),
          `测试输出显示有失败：\n${r.stdout}\n${r.stderr}`,
        );
      },
    },
    {
      name: '回归守卫：默认配置的解析结果没变',
      fn: async ({ dir }) => {
        const { readConfig } = loadMod(dir, 'src/config.js');
        const cfg = await readConfig(MISSING_CONFIG);
        assert.deepStrictEqual(
          cfg,
          { name: 'app', port: 3000, debug: false, features: { beta: false, cache: true } },
          `默认配置不对：${JSON.stringify(cfg)} —— 解析逻辑一个字都不许改`,
        );
      },
    },
    {
      name: '回归守卫：自定义配置的解析结果没变（端口转数字 + 嵌套合并）',
      fn: async ({ dir }) => {
        const { readConfig } = loadMod(dir, 'src/config.js');
        const tmp = writeTempConfig({
          name: 'svc',
          port: '8080',
          debug: true,
          features: { beta: true },
        });
        try {
          const cfg = await readConfig(tmp);
          assert.deepStrictEqual(
            cfg,
            { name: 'svc', port: 8080, debug: true, features: { beta: true, cache: true } },
            `自定义配置解析不对：${JSON.stringify(cfg)}`,
          );
        } finally {
          unlinkQuiet(tmp);
        }
      },
    },
    {
      name: '回归守卫：只给部分字段时其余用默认值',
      fn: async ({ dir }) => {
        const { readConfig } = loadMod(dir, 'src/config.js');
        const tmp = writeTempConfig({ port: 1234 });
        try {
          const cfg = await readConfig(tmp);
          assert.strictEqual(cfg.port, 1234, `port 不对：${cfg.port}`);
          assert.strictEqual(cfg.name, 'app', `name 不对：${cfg.name}`);
          assert.strictEqual(cfg.debug, false, `debug 不对：${cfg.debug}`);
          assert.deepStrictEqual(cfg.features, { beta: false, cache: true });
        } finally {
          unlinkQuiet(tmp);
        }
      },
    },
    {
      name: '回归守卫：配置文件损坏时回落到默认值（try/catch 没被删）',
      fn: async ({ dir }) => {
        const { readConfig } = loadMod(dir, 'src/config.js');
        const tmp = writeTempConfig('{ this is not valid json ');
        try {
          const cfg = await readConfig(tmp);
          assert.deepStrictEqual(
            cfg,
            { name: 'app', port: 3000, debug: false, features: { beta: false, cache: true } },
            `损坏的配置文件应该回落到默认值，实际：${JSON.stringify(cfg)}`,
          );
        } finally {
          unlinkQuiet(tmp);
        }
      },
    },
    {
      name: '回归守卫：DEFAULTS 常量没被改',
      fn: ({ dir }) => {
        const { DEFAULTS } = loadMod(dir, 'src/config.js');
        assert.deepStrictEqual(
          DEFAULTS,
          { name: 'app', port: 3000, debug: false, features: { beta: false, cache: true } },
          'DEFAULTS 被改了 —— 解析逻辑不许动',
        );
      },
    },
    {
      name: '回归守卫：五个调用方模块都还在、导出没被删',
      fn: ({ dir }) => {
        const expected = {
          'src/loader.js': ['loadConfig', 'readConfig'],
          'src/server.js': ['startServer'],
          'src/worker.js': ['processTask'],
          'src/cli.js': ['main', 'printConfig'],
          'src/bootstrap.js': ['bootstrap'],
        };
        for (const [rel, names] of Object.entries(expected)) {
          const mod = loadMod(dir, rel);
          for (const n of names) {
            assert.strictEqual(
              typeof mod[n],
              'function',
              `${rel} 的 ${n} 不见了 —— 不许删调用方，也不许删重新导出的那一层`,
            );
          }
        }
      },
    },
    {
      name: '回归守卫：四个测试文件都还在，测试没被删',
      fn: ({ dir }) => {
        const expected = {
          'test/loader.test.js': ['loadConfig 返回默认配置', 'loadConfig 读取自定义配置'],
          'test/server.test.js': ['服务器启动后能拿到配置', '服务器能响应 HTTP 请求'],
          'test/worker.test.js': ['任务处理完能拿到配置'],
          'test/bootstrap.test.js': ['启动后能拿到配置'],
        };
        for (const [rel, names] of Object.entries(expected)) {
          const mod = loadMod(dir, rel);
          for (const n of names) {
            assert.strictEqual(
              typeof mod[n],
              'function',
              `${rel} 里的测试「${n}」不见了 —— 不许删测试`,
            );
          }
        }
      },
    },
    {
      name: '回归守卫：测试的断言期望值没被改',
      fn: ({ dir }) => {
        const checks = [
          ['test/loader.test.js', ['http://app:3000', "'svc'", '8080']],
          ['test/server.test.js', ["'ok'", '3000']],
          ['test/worker.test.js', ['3000', "'app'"]],
          ['test/bootstrap.test.js', ['3000', "'app'"]],
        ];
        for (const [rel, literals] of checks) {
          const src = readSrc(dir, rel);
          for (const lit of literals) {
            assert.ok(
              src.includes(lit),
              `${rel} 里找不到断言期望值 ${lit} —— 不许改测试的期望值来"凑绿"`,
            );
          }
        }
      },
    },
    {
      name: '回归守卫：测试文件里没有被 skip / only',
      fn: ({ dir }) => {
        for (const rel of [
          'test/loader.test.js',
          'test/server.test.js',
          'test/worker.test.js',
          'test/bootstrap.test.js',
        ]) {
          const src = readSrc(dir, rel);
          assert.ok(
            !/\.skip\b|\.only\b|\bit\.skip\b|\bxit\b|\bxtest\b/.test(src),
            `${rel} 里出现了 skip / only —— 那是绕过测试，不是修问题`,
          );
        }
      },
    },
    {
      name: '回归守卫：测试运行器还在跑那四个测试文件',
      fn: ({ dir }) => {
        const src = readSrc(dir, 'test/run-all.js');
        for (const f of [
          'loader.test.js',
          'server.test.js',
          'worker.test.js',
          'bootstrap.test.js',
        ]) {
          assert.ok(src.includes(f), `run-all.js 里没有跑 ${f} —— 不许绕过测试`);
        }
      },
    },
  ],
};
