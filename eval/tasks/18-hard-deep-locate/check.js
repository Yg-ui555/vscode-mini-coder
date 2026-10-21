/**
 * 验收脚本 —— 深埋定位 + 同名文件诱饵
 *
 * 判定要点：
 *   1. profile/format.js 的空白昵称回退修好了      （baseline 挂）
 *   2. 两个同名诱饵文件一个字节都没被碰            （回归守卫，baseline 过）
 *   3. profile/format.js 的其余函数没被改坏         （回归守卫，baseline 过）
 *   4. 其余文件与输出逐字不变                       （副作用守卫，baseline 过）
 *   5. 确实用了目录遍历类工具去找这份代码           （baseline 挂）
 *
 * ⚠️ case 2 是本题真正的价值：它专门抓"改错同名文件还觉得自己修好了"
 *    这种失败——那种情况下 agent 报告说修复完成，bug 却一点没动。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { listFiles, fileSha } = require('../../shared');

const SHA = {
  'src/services/audit/format.js': '84febdef5771d96d',
  'src/legacy/v1/render/format.js': 'adefd0a6999ef3c8',
  'index.js': 'db1b06469051151a',
  'src/app.js': '4f5acad96e691839',
};

const PROFILE = 'src/services/account/profile/format.js';

function sha16(file) {
  return fileSha(file);
}

/**
 * ⭐ listFiles() 默认【不含】.notes/ 和 .mini-coder/，这正是这里想要的
 *
 * 这两个目录是插件自己的簿记：agent 调 record_note 往 .notes/ 写一条笔记，
 * 那是【产品的正常功能】，不是它乱动了别人的东西。
 * 2026-10-21 第一次跑这道题时用的是「列出所有文件」，agent 记了条错题本，
 * 就被文件集合断言判成了 regressed —— 典型的"测量工具的 bug 比被测对象更可怕"：
 * agent 做对了却被判成弄坏了东西，而真正的 bug（断言写错了）反倒被藏了起来。
 * 详见 eval/shared.js 顶部的说明。
 */

module.exports = {
  taskId: '18-hard-deep-locate',

  cases: [
    {
      // ⭐ baseline 挂
      name: 'profile/format.js：空白 / 缺失昵称能正确回退到 handle',
      fn: ({ dir }) => {
        const f = require(path.join(dir, PROFILE));

        // 报错的那两个用户
        assert.strictEqual(
          f.displayName({ name: '   ', handle: 'nobody' }),
          'nobody',
          '昵称全是空格时，应该回退到 handle'
        );
        assert.strictEqual(
          f.displayName({ handle: 'ghost' }),
          'ghost',
          '昵称字段缺失时，应该回退到 handle'
        );

        // 边界：handle 也没有才回退 anonymous
        assert.strictEqual(f.displayName({ name: '  ' }), 'anonymous', '连 handle 都没有才回退 anonymous');
        assert.strictEqual(f.displayName({}), 'anonymous', '空对象应回退 anonymous');
        assert.strictEqual(f.displayName(null), 'anonymous', 'null 应回退 anonymous');
        assert.strictEqual(f.displayName(undefined), 'anonymous', 'undefined 应回退 anonymous');
        assert.strictEqual(f.displayName({ name: 123, handle: 'num' }), 'num', '昵称不是字符串时应回退 handle');

        // ⚠️ 不能把 audit 那份的实现抄过来
        assert.notStrictEqual(
          f.displayName({ name: '张三', handle: 'zhangsan' }),
          'system',
          'displayName 返回了 system —— 说明把 audit/format.js 的实现抄过来了'
        );

        // 正常用户不能被改坏
        assert.strictEqual(f.displayName({ name: '张三', handle: 'zhangsan' }), '张三', '正常昵称原样返回');
        assert.strictEqual(f.displayName({ name: '  李四  ', handle: 'lisi' }), '李四', '昵称应去掉首尾空格');

        // 下游两个函数跟着一起修好了
        assert.strictEqual(f.initials({ name: '   ', handle: 'nobody' }), 'N', '空白昵称时首字母应取 handle');
        assert.strictEqual(f.initials({ handle: 'ghost' }), 'G', '缺昵称时首字母应取 handle');
        assert.strictEqual(f.initials({}), '?', '既没昵称也没 handle 时 initials 应为 ?');
        assert.strictEqual(
          f.profileLine({ name: '   ', handle: 'nobody' }),
          'nobody (nobody)',
          '空白昵称时 profileLine 应显示 handle'
        );

        // ⭐ 修好之后 main() 的完整输出（黄金值）
        const idx = require(path.join(dir, 'index.js'));
        assert.strictEqual(
          idx.main(),
          [
            '张三 (zhangsan) 张',
            '李四 (lisi) 李',
            'nobody (nobody) N',
            'ghost (ghost) G',
            '---',
            '09:00 alice login',
            '09:05 system logout',
            '---',
            'Bob|未命名|admin',
          ].join('\n'),
          'main() 的完整输出不对——空白昵称那两个用户还没修好，或者别的行为被改坏了'
        );
      },
    },

    {
      // ⭐ baseline 挂 —— 定位证据（baseline 阶段 transcript 是空的）
      name: '【定位证据】用了 glob / list_dir / grep 至少一个去找这份代码',
      fn: ({ transcript }) => {
        const explorers = transcript.filter((t) =>
          ['glob', 'list_dir', 'grep'].includes(t.tool)
        );
        assert.ok(
          explorers.length > 0,
          '目标文件埋在 5 层目录里，且有三个同名文件；' +
            '整个过程里没有调用过 glob / list_dir / grep 任何一个'
        );
      },
    },

    {
      // 回归守卫 —— 本题核心：诱饵不许被碰
      name: '【诱饵】audit/format.js 和 legacy/v1/render/format.js 一个字节都没被碰',
      fn: ({ dir }) => {
        for (const [rel, sha] of Object.entries(SHA)) {
          if (rel === 'index.js' || rel === 'src/app.js') continue; // 这两个在 case 4 里查
          const file = path.join(dir, rel);
          assert.ok(fs.existsSync(file), `${rel} 不该被删除或改名`);
          assert.strictEqual(
            sha16(file),
            sha,
            `${rel} 被改了。这份文件和 profile/format.js 同名/同名函数，但契约不同，不该动`
          );
        }

        // 行为上也再确认一遍（防止"改了又改回来"）
        const audit = require(path.join(dir, 'src/services/audit/format.js'));
        assert.strictEqual(audit.displayName({ actor: 'alice' }), 'alice', 'audit.displayName 行为不能变');
        assert.strictEqual(audit.displayName({}), 'system', 'audit.displayName 兜底不能变');
        assert.strictEqual(
          audit.auditLine({ time: '09:00', actor: 'alice', action: 'login' }),
          '09:00 alice login',
          'auditLine 输出不能变'
        );

        const legacy = require(path.join(dir, 'src/legacy/v1/render/format.js'));
        assert.strictEqual(legacy.formatName('  Bob '), 'Bob', 'formatName 不能变');
        assert.strictEqual(legacy.formatName('   '), '未命名', 'formatName 空串处理不能变');
        assert.strictEqual(legacy.formatRole('Admin'), 'admin', 'formatRole 不能变');
      },
    },

    {
      // 回归守卫
      name: '【回归】profile/format.js 的其余函数行为不变',
      fn: ({ dir }) => {
        const f = require(path.join(dir, PROFILE));

        // 导出表不能变
        assert.deepStrictEqual(
          Object.keys(f).sort(),
          ['ANONYMOUS', 'displayName', 'initials', 'profileLine'],
          'profile/format.js 的导出表变了'
        );

        assert.strictEqual(f.ANONYMOUS, 'anonymous', 'ANONYMOUS 常量不能变');

        // initials 的行为不能变（只断言【修之前就正确】的那部分，
        // 修好之后才成立的断言放在上面的修复 case 里）
        assert.strictEqual(f.initials({ name: '张三', handle: 'zhangsan' }), '张', 'initials 取首字并大写');
        assert.strictEqual(f.initials({ name: 'alice', handle: 'alice' }), 'A', '英文也要大写');
        assert.strictEqual(f.initials(null), '?', '无名用户 initials 应为 ?');

        // profileLine 的格式不能变：「显示名 (handle)」，handle 一定要在
        assert.strictEqual(
          f.profileLine({ name: '张三', handle: 'zhangsan' }),
          '张三 (zhangsan)',
          'profileLine 格式不能变'
        );
      },
    },

    {
      // 副作用守卫
      name: '【副作用】文件集合、其余文件、另外两页输出全部不变',
      fn: ({ dir }) => {
        assert.deepStrictEqual(
          listFiles(dir),
          [
            'index.js',
            'src/app.js',
            'src/legacy/v1/render/format.js',
            'src/routes/user.js',
            'src/services/account/profile/format.js',
            'src/services/audit/format.js',
            'test/smoke.js',
          ],
          '仓库文件集合变了（多了或少了文件）'
        );

        // 这三个不该被改
        for (const rel of ['index.js', 'src/app.js']) {
          assert.strictEqual(sha16(path.join(dir, rel)), SHA[rel], `${rel} 不该被改`);
        }

        // 另外两页的输出逐字不变
        const app = require(path.join(dir, 'src/app.js'));
        assert.strictEqual(
          app.auditPage(),
          '09:00 alice login\n09:05 system logout',
          '审计日志页输出不能变'
        );
        assert.strictEqual(
          app.legacyPage(),
          'Bob|未命名|admin',
          'v1 报表页输出不能变'
        );

        // 修好之后 main() 的完整输出断言见「修复」那个 case，
        // 这里只保证入口 / 路由 / 演示数据本身没被偷偷改

        // 用户路由模块本身不该被改
        const user = require(path.join(dir, 'src/routes/user.js'));
        assert.deepStrictEqual(Object.keys(user).sort(), ['USERS', 'userPage', 'userRow']);
        assert.strictEqual(user.USERS.length, 4, '演示数据不该被改');
      },
    },
  ],
};