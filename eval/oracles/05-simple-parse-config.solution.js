/**
 * 05-simple-parse-config 的标准答案
 *
 * ⭐ 这份文件的作用是【证明这道题可解】：
 *   verifySolvable.ts 会把 initial/ 复制到沙箱、执行本文件、再跑全部 case，
 *   要求一个 case 都不挂。
 *
 * 标准答案的写法：在解析前加一条"整行注释"判断 —— 先 trim，再看是不是以 # 开头。
 *
 * ⚠️ 这道题最容易漏的边界：
 *   · 注释行要【先 trim 再判断】：'    # port = 3306' 也得跳过
 *   · 值里的 '#' 不是注释：'color = #ff0000' 必须原样解析出来
 *   · 值里的 '=' 只按第一个切：'cmd = a=b=c' -> { cmd: 'a=b=c' }
 *   · 空行 / 纯空白行 / 没有 '=' 的行都跳过
 *   · null / undefined / 数字必须返回 {}，不能抛异常
 *   · getConfigValue 的默认值机制不能动：key 存在就返回它的值（哪怕是空字符串）
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  taskId: '05-simple-parse-config',

  apply(dir) {
    fs.writeFileSync(
      path.join(dir, 'config.js'),
      [
        '/**',
        ' * 解析 key=value 格式的简单配置文本',
        ' *',
        ' * 典型用法：',
        " *   const { parseConfig } = require('./config');",
        " *   parseConfig('host = localhost\\nport = 8080');",
        " *   // => { host: 'localhost', port: '8080' }",
        ' */',
        '',
        '/**',
        ' * 解析配置文本',
        ' * @param {string} text',
        ' * @returns {Object<string, string>}',
        ' */',
        'function parseConfig(text) {',
        '  // 非字符串（null / undefined / 数字）直接返回空表，不抛异常',
        "  if (typeof text !== 'string') {",
        '    return {};',
        '  }',
        '',
        '  const result = {};',
        '  const lines = text.split(\'\\n\');',
        '  for (const line of lines) {',
        '    const t = line.trim();',
        '    if (!t) continue;',
        '    // 整行注释：先 trim 再判断，所以带缩进的注释同样会被跳过。',
        "    // 只有【整行】开头是 # 才算注释 —— 值里的 # 属于值的一部分。",
        "    if (t.startsWith('#')) continue;",
        '    // 只按第一个 = 分割，值里再出现 = 就原样留着',
        '    const i = t.indexOf(\'=\');',
        '    if (i < 0) continue;',
        '    const key = t.slice(0, i).trim();',
        '    const value = t.slice(i + 1).trim();',
        '    result[key] = value;',
        '  }',
        '  return result;',
        '}',
        '',
        '/**',
        ' * 读一个配置项，读不到就用默认值',
        ' * @param {string} text',
        ' * @param {string} key',
        ' * @param {*} defaultValue',
        ' * @returns {*}',
        ' */',
        'function getConfigValue(text, key, defaultValue) {',
        '  const cfg = parseConfig(text);',
        '  return key in cfg ? cfg[key] : defaultValue;',
        '}',
        '',
        'module.exports = { parseConfig, getConfigValue };',
        '',
      ].join('\n'),
      'utf-8'
    );
  },
};
