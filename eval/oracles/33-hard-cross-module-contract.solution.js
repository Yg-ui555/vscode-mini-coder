/**
 * 标准答案 —— 33-hard-cross-module-contract
 *
 * 目的：证明这道题【有解】。
 *
 * 标准解法（6 步）：
 *   1. src/records.js  —— 加一个形状转换函数，findRecord / listRecords 返回新结构
 *   2. src/format.js  —— rec.name / rec.ownerId → rec.title / rec.owner.name
 *   3. src/list.js    —— 排序字段 rec.name → rec.title
 *                         （⚠️ 只改 formatRecord 不够，排序也要改）
 *   4. src/api.js     —— 取值来源变了，对外字段不变：
 *                         rec.name → rec.title，rec.ownerId → rec.owner.id
 *   5. test/format.test.js —— 期望值更新
 *   6. test/list.test.js   —— 期望值更新
 *
 * ⚠️ test/api.test.js 【一个字都不改】——
 *    对外契约没变，这是本题要考的核心。
 */

const fs = require('fs');
const path = require('path');

/** 替换并校验锚点存在 */
function replaceOnce(src, from, to, where) {
  if (!src.includes(from)) {
    throw new Error(`标准答案锚点没找到（${where}）：\n${from}`);
  }
  return src.replace(from, to);
}

/** 读改写 */
function patch(dir, rel, fn) {
  const p = path.join(dir, rel);
  const src = fs.readFileSync(p, 'utf-8');
  fs.writeFileSync(p, fn(src), 'utf-8');
}

module.exports = {
  taskId: '33-hard-cross-module-contract',

  apply(dir) {
    // ── 1. records.js：加形状转换 ──
    patch(dir, 'src/records.js', (src) => {
      let out = src;

      out = replaceOnce(
        out,
        [
          'function findRecord(id) {',
          '  const raw = RECORDS.find((r) => r.id === id);',
          '  if (!raw) return null;',
          '  return { ...raw };',
          '}',
        ].join('\n'),
        [
          '/**',
          ' * 把原始记录转成新的对外结构',
          ' */',
          'function toPublicShape(raw) {',
          '  const owner = OWNERS[raw.ownerId];',
          '  return {',
          '    id: raw.id,',
          '    title: raw.name,',
          '    status: raw.status,',
          '    owner: owner',
          "      ? { id: owner.id, name: owner.name }",
          "      : { id: raw.ownerId, name: 'unknown' },",
          '  };',
          '}',
          '',
          'function findRecord(id) {',
          '  const raw = RECORDS.find((r) => r.id === id);',
          '  if (!raw) return null;',
          '  return toPublicShape(raw);',
          '}',
        ].join('\n'),
        'src/records.js / findRecord',
      );

      out = replaceOnce(
        out,
        ['function listRecords() {', '  return RECORDS.map((r) => ({ ...r }));', '}'].join('\n'),
        ['function listRecords() {', '  return RECORDS.map(toPublicShape);', '}'].join('\n'),
        'src/records.js / listRecords',
      );

      return out;
    });

    // ── 2. format.js ──
    patch(dir, 'src/format.js', (src) =>
      replaceOnce(
        src,
        '  return `${rec.name} by ${rec.ownerId}`;',
        '  return `${rec.title} by ${rec.owner.name}`;',
        'src/format.js',
      ),
    );

    // ── 3. list.js：排序字段也要改 ──
    patch(dir, 'src/list.js', (src) =>
      replaceOnce(
        src,
        '    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))',
        '    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))',
        'src/list.js',
      ),
    );

    // ── 4. api.js：取值来源变了，对外字段不变 ──
    patch(dir, 'src/api.js', (src) =>
      replaceOnce(
        src,
        ['    title: rec.name,', '    ownerId: rec.ownerId,'].join('\n'),
        ['    title: rec.title,', '    ownerId: rec.owner.id,'].join('\n'),
        'src/api.js',
      ),
    );

    // ── 5. format.test.js：期望值更新 ──
    patch(dir, 'test/format.test.js', (src) => {
      let out = src;
      out = replaceOnce(
        out,
        "assert.strictEqual(formatRecord(rec), 'Alpha by u-7');",
        "assert.strictEqual(formatRecord(rec), 'Alpha by 张伟');",
        'test/format.test.js / r-1',
      );
      out = replaceOnce(
        out,
        "assert.strictEqual(formatRecord(rec), 'Delta by u-404');",
        "assert.strictEqual(formatRecord(rec), 'Delta by unknown');",
        'test/format.test.js / r-4',
      );
      return out;
    });

    // ── 6. list.test.js：期望值更新 ──
    patch(dir, 'test/list.test.js', (src) =>
      replaceOnce(
        src,
        [
          "    'Alpha by u-7',",
          "    'Beta by u-9',",
          "    'Delta by u-404',",
          "    'Gamma by u-7',",
        ].join('\n'),
        [
          "    'Alpha by 张伟',",
          "    'Beta by 李娜',",
          "    'Delta by unknown',",
          "    'Gamma by 张伟',",
        ].join('\n'),
        'test/list.test.js',
      ),
    );

    // ── test/api.test.js：一个字都不改（对外契约没变）──
  },
};
