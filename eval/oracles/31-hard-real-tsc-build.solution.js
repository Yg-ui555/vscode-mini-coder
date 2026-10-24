/**
 * 标准答案 —— 31-hard-real-tsc-build
 *
 * 目的：证明这道题【有解】。
 *   如果连人写的标准答案都过不了所有 case，
 *   那这道题就不是难题，是废题 ——
 *   它会以「满分率下降」的形式把评测者引到错误方向。
 *
 * 应用方式：
 *   1. 修 types.ts 的两个类型错误
 *   2. 修 format.ts 的两个类型错误
 *   3. 修 cli.ts 的参数个数错误 + 把 as 断言换成真正的收窄
 *   4. 给 FormatStyle 加 'compact'，并实现
 *   5. 让 CLI 认 compact
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  taskId: '31-hard-real-tsc-build',

  apply(dir) {
    // ── 1. types.ts：修 id 和 tags 的类型错误 ──
    const typesPath = path.join(dir, 'types.ts');
    let types = fs.readFileSync(typesPath, 'utf-8');
    types = types.replace(
      `export function createUser(name: string, age: number): User {
  return {
    id: 'u-001',
    name,
    age,
    tags: [1, 2],
  };
}`,
      `export function createUser(name: string, age: number): User {
  return {
    id: 1,
    name,
    age,
    tags: ['default', 'new'],
  };
}`,
    );
    fs.writeFileSync(typesPath, types, 'utf-8');

    // ── 2. format.ts：修 null 赋值、不存在的方法、FormatStyle 加 compact ──
    const formatPath = path.join(dir, 'format.ts');
    let format = fs.readFileSync(formatPath, 'utf-8');

    format = format.replace(
      `export type FormatStyle = 'full' | 'short';`,
      `export type FormatStyle = 'full' | 'short' | 'compact';`,
    );

    format = format.replace(
      `function firstTag(user: User): string {
  const tag: string = null;
  return tag;
}`,
      `function firstTag(user: User): string {
  const tag: string = user.tags[0] ?? '';
  return tag;
}`,
    );

    format = format.replace(
      `function describeUser(user: User): string {
  return user.describe();
}`,
      `function describeUser(user: User): string {
  return \`\${user.name}(\${user.age})\`;
}`,
    );

    // 加 compact 分支
    format = format.replace(
      `    case 'short':
      return \`\${user.name}(\${user.age})\`;
  }
}`,
      `    case 'short':
      return \`\${user.name}(\${user.age})\`;
    case 'compact':
      return \`\${user.name}(\${user.age})\`;
  }
}`,
    );

    // formatUser 要支持 compact 用 ", " 分隔
    format = format.replace(
      `export function formatUser(users: User[], style: FormatStyle = 'full'): string {
  if (users.length === 0) return '';
  // ⚠️ 错误 TS2345：users 是数组，这里传给了只接受单个 User 的 formatOne
  return users.map((u) => formatOne(u, style)).join('\\n');
}`,
      `export function formatUser(users: User[], style: FormatStyle = 'full'): string {
  if (users.length === 0) return '';
  if (style === 'compact') {
    return users.map((u) => formatOne(u, style)).join(', ');
  }
  return users.map((u) => formatOne(u, style)).join('\\n');
}`,
    );

    fs.writeFileSync(formatPath, format, 'utf-8');

    // ── 3. cli.ts：修参数个数 + 把 as 断言换成真正的收窄 + 认 compact ──
    const cliPath = path.join(dir, 'cli.ts');
    let cli = fs.readFileSync(cliPath, 'utf-8');

    cli = cli.replace(
      `export function parseFormat(arg: string | undefined): FormatStyle {
  if (arg === 'short') return 'short';
  return arg as FormatStyle;
}`,
      `export function parseFormat(arg: string | undefined): FormatStyle {
  if (arg === 'short') return 'short';
  if (arg === 'compact') return 'compact';
  return 'full';
}`,
    );

    cli = cli.replace(
      `  // ⚠️ 错误 TS2554：formatUser 只接受 2 个参数，这里传了 3 个
  return formatUser(users, style, 'extra');`,
      `  return formatUser(users, style);`,
    );

    fs.writeFileSync(cliPath, cli, 'utf-8');
  },
};
