/**
 * 01-simple-username-validate 的标准答案
 *
 * ⭐ 这份文件的作用是【证明这道题可解】：
 *   verifySolvable.ts 会把 initial/ 复制到沙箱、执行本文件、再跑全部 case，
 *   要求一个 case 都不挂。
 *
 * 标准答案的写法：把 task.md 要求的 4 条校验按顺序补进 validateUsername。
 *
 * ⚠️ 这道题最容易漏的边界：
 *   · 长度 3 和 20 都合法 —— 闭区间，写成 < 3 / > 20 的开区间就会挂
 *   · 非字符串输入必须先挡掉：原实现直接读 name.length，
 *     传数字 / null / undefined 会抛 TypeError，而不是返回 false
 *   · 下划线不能开头也不能结尾（'_' 单独出现时长度校验已经拦住了）
 *   · 非法字符用一条 /^[A-Za-z0-9_]+$/ 判掉：中文、空格、连字符都会落到 false
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  taskId: '01-simple-username-validate',

  apply(dir) {
    fs.writeFileSync(
      path.join(dir, 'username.js'),
      [
        '/**',
        ' * 用户名校验',
        ' */',
        '',
        'function validateUsername(name) {',
        '  // 非字符串直接判非法：原实现直接读 name.length，',
        '  // 传数字 / null / undefined 会抛 TypeError，而不是返回 false',
        "  if (typeof name !== 'string') {",
        '    return false;',
        '  }',
        '',
        '  // 长度必须在 3~20 之间（闭区间；这条是原有的校验，逻辑一个字没动）',
        '  if (name.length < 3 || name.length > 20) {',
        '    return false;',
        '  }',
        '',
        '  // 只能包含英文字母、数字、下划线',
        '  if (!/^[A-Za-z0-9_]+$/.test(name)) {',
        '    return false;',
        '  }',
        '',
        '  // 下划线不能开头也不能结尾',
        "  if (name.startsWith('_') || name.endsWith('_')) {",
        '    return false;',
        '  }',
        '',
        '  return true;',
        '}',
        '',
        'module.exports = { validateUsername };',
        '',
      ].join('\n'),
      'utf-8'
    );
  },
};
