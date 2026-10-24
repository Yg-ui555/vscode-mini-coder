/**
 * 验收脚本 —— 跨模块契约变更题
 *
 * ⭐ 本题的核心不是"改字段名"，而是【改了一边，另一边不能跟着变】。
 *
 * 陷阱设计：
 *   1. 只改数据源不改消费者 → 消费者拿到 undefined，测试红
 *   2. 只改消费者不改数据源 → 一样红
 *   3. ⭐ 只改了一半的消费者（list.js 有【两条】依赖路径：
 *      一条调用 formatRecord，一条排序时自己读字段）
 *      → 排序失效，顺序错，但内容看着都对 —— 这是最隐蔽的一种
 *   4. ⭐⭐ 把内部改名"顺手透传"到对外 API（title 从 rec.name 改完
 *      直接改成 rec.title 就完事了）→ 对外契约被破坏，
 *      而这正是最容易被当成"重构顺手做的"那类改动
 *
 * ⚠️ 为什么"对外输出不变"是回归守卫而不是目标：
 *   它在 baseline 就是对的，改完之后必须【还是】对的。
 *   agent 改坏了它 → baseline 过 / after 挂 → 判定为【回归】，
 *   比"没改对"更严重。这正是 L4 回归检测存在的意义。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

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

/** 跑一个 node 子进程 */
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
  taskId: '33-hard-cross-module-contract',

  cases: [
    // ═══ 本题目标（baseline 挂 → after 过）═══
    {
      name: '⭐⭐ findRecord 返回新的内部结构（title + owner 对象）',
      fn: ({ dir }) => {
        const { findRecord } = loadMod(dir, 'src/records.js');
        const rec = findRecord('r-1');
        assert.ok(rec, 'findRecord("r-1") 应该返回记录');
        assert.strictEqual(rec.id, 'r-1', `id 不对：${rec.id}`);
        assert.strictEqual(rec.title, 'Alpha', `title 不对：${rec.title} —— 是不是没把 name 改成 title？`);
        assert.strictEqual(rec.status, 'open', `status 不对：${rec.status}`);
        assert.deepStrictEqual(
          rec.owner,
          { id: 'u-7', name: '张伟' },
          `owner 不对：${JSON.stringify(rec.owner)} —— ownerId 应该解析成 { id, name }`,
        );
      },
    },
    {
      name: '⭐⭐ formatRecord 输出新的格式（显示 owner 姓名）',
      fn: ({ dir }) => {
        const { formatRecord } = loadMod(dir, 'src/format.js');
        const { findRecord } = loadMod(dir, 'src/records.js');
        const out = formatRecord(findRecord('r-1'));
        assert.strictEqual(
          out,
          'Alpha by 张伟',
          `formatRecord 输出不对：${JSON.stringify(out)} —— 应该是 '<title> by <owner 姓名>'`,
        );
      },
    },
    {
      name: '⭐⭐ renderList 输出正确（按 title 升序）',
      fn: ({ dir }) => {
        const { renderList } = loadMod(dir, 'src/list.js');
        const out = renderList();
        assert.deepStrictEqual(
          out,
          ['Alpha by 张伟', 'Beta by 李娜', 'Delta by unknown', 'Gamma by 张伟'],
          `renderList 输出不对：\n${JSON.stringify(out, null, 2)}\n` +
            `⚠️ 注意顺序：排序要按 title（旧的 name 字段已经没了），` +
            `排序没改的话 Alpha/Beta/Delta/Gamma 会变成 Alpha/Beta/Gamma/Delta`,
        );
      },
    },
    {
      name: '⭐⭐ owner 查不到时 owner 是 { id, name: "unknown" }（不是 null）',
      fn: ({ dir }) => {
        const { findRecord } = loadMod(dir, 'src/records.js');
        const rec = findRecord('r-4');
        assert.ok(rec, 'findRecord("r-4") 应该返回记录');
        assert.deepStrictEqual(
          rec.owner,
          { id: 'u-404', name: 'unknown' },
          `owner 不对：${JSON.stringify(rec.owner)} —— 查不到时 owner 应该是 { id: 原 ownerId, name: 'unknown' }`,
        );
      },
    },
    {
      name: '⭐ formatRecord 对查不到 owner 的记录输出 "... by unknown"',
      fn: ({ dir }) => {
        const { formatRecord } = loadMod(dir, 'src/format.js');
        const { findRecord } = loadMod(dir, 'src/records.js');
        const out = formatRecord(findRecord('r-4'));
        assert.strictEqual(
          out,
          'Delta by unknown',
          `formatRecord 输出不对：${JSON.stringify(out)}`,
        );
      },
    },
    {
      name: '⭐ listRecords 也返回新的内部结构',
      fn: ({ dir }) => {
        const { listRecords } = loadMod(dir, 'src/records.js');
        const list = listRecords();
        assert.strictEqual(list.length, 4, `记录数不对：${list.length}`);
        for (const rec of list) {
          assert.strictEqual(typeof rec.title, 'string', `记录 ${rec.id} 没有 title 字段`);
          assert.ok(rec.owner && typeof rec.owner === 'object', `记录 ${rec.id} 的 owner 不是对象`);
          assert.strictEqual(typeof rec.owner.name, 'string', `记录 ${rec.id} 的 owner 没有姓名`);
          assert.strictEqual(typeof rec.owner.id, 'string', `记录 ${rec.id} 的 owner 没有 id`);
        }
      },
    },
    {
      name: '⭐ 两个受影响的测试文件期望值已经更新',
      fn: ({ dir }) => {
        // ⚠️ 只查"旧的期望值没了"，不查"新的期望值长什么样" ——
        //   新期望值的具体写法（字面量还是拼接）不该被限定死，
        //   真正把关的是"测试跑起来是绿的"那条。
        const stale = {
          'test/format.test.js': ['by u-7', 'by u-404'],
          'test/list.test.js': ['by u-7', 'by u-9', 'by u-404'],
        };
        for (const [rel, olds] of Object.entries(stale)) {
          const src = readSrc(dir, rel);
          for (const o of olds) {
            assert.ok(
              !src.includes(o),
              `${rel} 里还留着旧期望值 "${o}" —— 对外行为变了，测试期望值必须一起更新`,
            );
          }
        }
      },
    },

    // ═══ 回归守卫（baseline 必须通过，after 也必须通过）═══
    {
      name: '⭐⭐⭐ 对外 API 的输出完全没变（这是本题最关键的一条）',
      fn: ({ dir }) => {
        const { toApiPayload } = loadMod(dir, 'src/api.js');
        const { findRecord } = loadMod(dir, 'src/records.js');

        const p1 = toApiPayload(findRecord('r-1'));
        assert.deepStrictEqual(
          p1,
          { id: 'r-1', title: 'Alpha', ownerId: 'u-7' },
          `对外 payload 变了：${JSON.stringify(p1)}\n` +
            `⚠️ 对外契约一个字都不许动 —— 内部改名不能透传出去`,
        );

        const p4 = toApiPayload(findRecord('r-4'));
        assert.deepStrictEqual(
          p4,
          { id: 'r-4', title: 'Delta', ownerId: 'u-404' },
          `对外 payload 变了：${JSON.stringify(p4)}\n` +
            `⚠️ owner 查不到时，对外 ownerId 仍然是 'u-404'，不能是 null / undefined`,
        );
      },
    },
    {
      name: '⭐⭐⭐ node test/run-all.js 全绿',
      fn: ({ dir }) => {
        const r = runNode(dir, ['test/run-all.js'], 90_000);
        assert.strictEqual(
          r.code,
          0,
          `测试没全绿（退出码 ${r.code}）：\n${r.stdout}\n${r.stderr}`,
        );
        assert.ok(/失败\s*0\s*个/.test(r.stdout), `测试输出显示有失败：\n${r.stdout}\n${r.stderr}`);
      },
    },
    {
      name: '回归守卫：OWNERS 表没被改',
      fn: ({ dir }) => {
        const { OWNERS } = loadMod(dir, 'src/records.js');
        assert.deepStrictEqual(
          OWNERS,
          {
            'u-7': { id: 'u-7', name: '张伟' },
            'u-9': { id: 'u-9', name: '李娜' },
          },
          'OWNERS 表被改了 —— 你不应该动这份数据',
        );
      },
    },
    {
      name: '回归守卫：findRecord 查不到时仍然返回 null',
      fn: ({ dir }) => {
        const { findRecord } = loadMod(dir, 'src/records.js');
        assert.strictEqual(findRecord('r-999'), null, '查不到的记录应该返回 null');
      },
    },
    {
      name: '回归守卫：findRecord / listRecords 返回的是副本',
      fn: ({ dir }) => {
        const { findRecord, listRecords } = loadMod(dir, 'src/records.js');

        const rec = findRecord('r-1');
        rec.title = 'MUTATED';
        assert.strictEqual(
          findRecord('r-1').title,
          'Alpha',
          'findRecord 必须返回副本 —— 你把仓库里的原始对象直接暴露出去了',
        );

        const list = listRecords();
        list[0].title = 'MUTATED';
        assert.strictEqual(
          listRecords()[0].title,
          'Alpha',
          'listRecords 必须返回副本',
        );
      },
    },
    {
      name: '回归守卫：四个模块都还在、导出没被删',
      fn: ({ dir }) => {
        const expected = {
          'src/records.js': ['findRecord', 'listRecords'],
          'src/format.js': ['formatRecord'],
          'src/list.js': ['renderList'],
          'src/api.js': ['toApiPayload'],
        };
        for (const [rel, names] of Object.entries(expected)) {
          const mod = loadMod(dir, rel);
          for (const n of names) {
            assert.strictEqual(typeof mod[n], 'function', `${rel} 的 ${n} 不见了 —— 不许删模块`);
          }
        }
        // OWNERS 是数据不是函数，单独断言
        const records = loadMod(dir, 'src/records.js');
        assert.ok(records.OWNERS && typeof records.OWNERS === 'object', 'records.js 的 OWNERS 导出不见了');
      },
    },
    {
      name: '回归守卫：四个测试文件都还在，测试没被删',
      fn: ({ dir }) => {
        const expected = {
          'test/format.test.js': ['格式化一条记录', '格式化 owner 查不到的记录'],
          'test/list.test.js': ['渲染整个列表'],
          'test/api.test.js': ['转成 API payload', 'owner 查不到时 payload 的 ownerId 不变'],
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
      name: '回归守卫：对外 API 的测试期望值一个字都没改',
      fn: ({ dir }) => {
        const src = readSrc(dir, 'test/api.test.js');
        for (const lit of ["ownerId: 'u-7'", "ownerId: 'u-404'"]) {
          assert.ok(
            src.includes(lit),
            `test/api.test.js 里找不到 ${lit} —— 对外契约没变，这个测试的期望值一个字都不许动`,
          );
        }
      },
    },
    {
      name: '回归守卫：测试文件里没有被 skip / only',
      fn: ({ dir }) => {
        for (const rel of ['test/format.test.js', 'test/list.test.js', 'test/api.test.js']) {
          const src = readSrc(dir, rel);
          assert.ok(
            !/\.skip\b|\.only\b|\bit\.skip\b|\bxit\b|\bxtest\b/.test(src),
            `${rel} 里出现了 skip / only —— 那是绕过测试，不是修问题`,
          );
        }
      },
    },
    {
      name: '回归守卫：测试运行器还在跑那三个测试文件',
      fn: ({ dir }) => {
        const src = readSrc(dir, 'test/run-all.js');
        for (const f of ['format.test.js', 'list.test.js', 'api.test.js']) {
          assert.ok(src.includes(f), `run-all.js 里没有跑 ${f} —— 不许绕过测试`);
        }
      },
    },
  ],
};
