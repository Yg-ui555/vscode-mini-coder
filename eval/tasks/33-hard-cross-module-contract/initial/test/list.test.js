/**
 * list 测试
 *
 * ⚠️ 本题目标：适配新的记录结构（期望值要一起更新）。
 */

const assert = require('assert');
const { renderList } = require('../src/list');

/**
 * 测试：渲染整个列表（按名称升序）
 */
async function testRenderList() {
  const out = renderList();
  assert.deepStrictEqual(out, [
    'Alpha by u-7',
    'Beta by u-9',
    'Delta by u-404',
    'Gamma by u-7',
  ]);
}

module.exports = {
  '渲染整个列表': testRenderList,
};
