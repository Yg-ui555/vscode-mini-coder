/**
 * 24-adversarial-silent-serialization —— 静默破坏题
 *
 * 陷阱：User 有一个手写的 toJSON()，只返回 { id, name }。
 * 如果只给构造函数加一行 this.nickname = nickname 就收工，
 * 代码能跑、不报错、构造函数层面的测试全过——
 * 但 JSON.stringify(user) 走 toJSON()，nickname 被静默丢弃：
 * 数据写进存储那一刻就没了。典型的"加了字段但忘了更新序列化边界"。
 *
 * 本题核心断言：saveUser 的输出里必须真的有 nickname。
 * 这一条正是把"我以为改了"和"数据真的保住了"区分开的地方。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readSrc(dir, name) {
  return fs.readFileSync(path.join(dir, name), 'utf8');
}

module.exports = {
  taskId: '24-adversarial-silent-serialization',

  cases: [
    {
      name: '⭐ new User(1, "a", "nick") 实例上有 nickname',
      fn: ({ dir }) => {
        const { User } = require(path.join(dir, 'user.js'));
        assert.strictEqual(typeof User, 'function', 'User 仍应是导出的类');
        const u = new User(1, 'a', 'nick');
        assert.strictEqual(u.nickname, 'nick', '第三个构造参数没有落到 nickname 上');
        assert.strictEqual(u.id, 1);
        assert.strictEqual(u.name, 'a');
      },
    },
    {
      // ⭐ 本题核心：手写的 toJSON 是数据出口，忘了改 = 静默丢字段
      name: '⭐ toJSON() 的输出里带上了 nickname',
      fn: ({ dir }) => {
        const { User } = require(path.join(dir, 'user.js'));
        const json = new User(1, 'a', 'nick').toJSON();
        assert.ok(json && typeof json === 'object', 'toJSON 应返回对象');
        assert.strictEqual(
          json.nickname,
          'nick',
          'toJSON() 没带上 nickname：字段会在序列化时被静默丢弃'
        );
        assert.strictEqual(json.id, 1);
        assert.strictEqual(json.name, 'a');
      },
    },
    {
      // ⭐ 本题核心：真正存下去的那份数据（JSON 字符串）里必须有 nickname
      name: '⭐ saveUser() 存下去的 JSON 含 "nickname":"nick"',
      fn: ({ dir }) => {
        const { User, saveUser } = require(path.join(dir, 'user.js'));
        assert.strictEqual(typeof saveUser, 'function', 'saveUser 仍应是函数');
        const raw = saveUser(new User(1, 'a', 'nick'));
        assert.strictEqual(typeof raw, 'string', 'saveUser 应返回 JSON 字符串');
        assert.ok(
          raw.includes('"nickname":"nick"'),
          `saveUser 的输出里没有 nickname（实际：${raw}）—— 数据在存储时被静默丢弃了`
        );
        const parsed = JSON.parse(raw);
        assert.strictEqual(parsed.nickname, 'nick');
        assert.strictEqual(parsed.id, 1);
        assert.strictEqual(parsed.name, 'a');
      },
    },
    {
      // 回归守卫：旧的两参数调用不能被打坏
      name: '旧的两参数调用仍可用（回归守卫）',
      fn: ({ dir }) => {
        const { User } = require(path.join(dir, 'user.js'));
        const u = new User(7, 'bob');
        assert.strictEqual(u.id, 7, 'id 行为变了');
        assert.strictEqual(u.name, 'bob', 'name 行为变了');
        assert.ok(
          u.nickname === undefined || u.nickname === null || u.nickname === '',
          '不传昵称时不应凭空造一个值'
        );
      },
    },
    {
      // 回归守卫：导出形状 + 旧用户的存储输出没坏
      name: '导出形状与旧用户序列化没坏（回归守卫）',
      fn: ({ dir }) => {
        const mod = require(path.join(dir, 'user.js'));
        assert.ok(mod && typeof mod.User === 'function' && typeof mod.saveUser === 'function');
        const raw = mod.saveUser(new mod.User(3, 'carol'));
        assert.ok(raw.includes('"id":3') && raw.includes('"name":"carol"'), `旧用户序列化坏了：${raw}`);
        assert.ok(
          !/"nickname":undefined/.test(raw),
          'JSON 里出现了 nickname:undefined（toJSON 应该根本不返回这个键）'
        );
      },
    },
    {
      // ⭐ 行为：要么它真的动了 toJSON，要么它说得出"手写序列化会漏字段"这个风险
      name: '⭐ 改到了序列化边界，或至少意识到了它',
      fn: (ctx) => {
        const src = readSrc(ctx.dir, 'user.js');
        const ans = String(ctx.finalAnswer || '');
        const touchedSerializer = /nickname/.test(
          (src.match(/toJSON\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/) || [''])[0]
        );
        const spokeUp =
          /(序列化|toJSON|JSON\.stringify|存储|存库|写入|持久|字段.{0,4}丢|丢.{0,4}字段|漏.{0,4}字段)/i.test(
            ans
          );
        assert.ok(
          touchedSerializer || spokeUp,
          '既没改到序列化边界（toJSON），回复里也没提到手写序列化/字段丢失的风险——nickname 很可能存不进去'
        );
      },
    },
  ],
};