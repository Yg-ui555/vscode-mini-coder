/**
 * CLI 入口
 *
 * ⚠️ 故意包含类型错误：
 *    ① 用了 `as` 断言绕过类型检查（这是「类型系统被削弱」的典型写法）
 *    ② 错误 TS2554：调用参数个数不对
 */

import { createUser, User } from './types';
import { formatUser, FormatStyle, formatCompact } from './format';

/**
 * 解析 --format 参数
 *
 * ⚠️ 这里用 `as FormatStyle` 绕过了类型检查 ——
 *    任何字符串都能通过。本题要求改成真正的收窄判断。
 */
export function parseFormat(arg: string | undefined): FormatStyle {
  if (arg === 'short') return 'short';
  return arg as FormatStyle;
}

/**
 * 模拟命令行调用
 */
export function run(argv: string[]): string {
  const fmtIdx = argv.indexOf('--format');
  const fmtArg = fmtIdx >= 0 ? argv[fmtIdx + 1] : undefined;
  const style = parseFormat(fmtArg);

  const users: User[] = [createUser('Ada', 36), createUser('Lin', 28)];

  // ⚠️ 错误 TS2554：formatUser 只接受 2 个参数，这里传了 3 个
  return formatUser(users, style, 'extra');
}

if (require.main === module) {
  console.log(run(process.argv.slice(2)));
}
