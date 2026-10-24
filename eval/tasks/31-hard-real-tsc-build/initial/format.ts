/**
 * 用户格式化
 *
 * ⚠️ 本文件故意包含【真实的 TypeScript 类型错误】：
 *    ① strict 模式下把 null 赋给非空类型（TS2322）
 *    ② 参数类型不匹配（TS2345）
 *    ③ 调用了对象上不存在的方法（TS2339）
 */

import { User } from './types';

/**
 * 格式化风格
 *
 * ⚠️ 本题目标：加一个 'compact' 选项。
 */
export type FormatStyle = 'full' | 'short';

/**
 * 取用户的第一个标签
 *
 * ⚠️ 错误 TS2322：strict 模式下 null 不能赋给 string。
 */
function firstTag(user: User): string {
  const tag: string = null;
  return tag;
}

/**
 * 格式化单个用户
 *
 * ⚠️ 错误 TS2339：User 上没有 describe() 方法。
 */
function describeUser(user: User): string {
  return user.describe();
}

/**
 * 格式化单个用户
 *
 * ⚠️ 错误 TS2345：参数类型写成了 User（单个），
 *    但调用方传进来的是 User[]（数组）。
 */
function formatOne(user: User, style: FormatStyle): string {
  switch (style) {
    case 'full':
      return `${user.name} (${user.age}岁, 标签: ${firstTag(user)})`;
    case 'short':
      return `${user.name}(${user.age})`;
  }
}

/**
 * 格式化用户列表
 */
export function formatUser(users: User[], style: FormatStyle = 'full'): string {
  if (users.length === 0) return '';
  // ⚠️ 错误 TS2345：users 是数组，这里传给了只接受单个 User 的 formatOne
  return users.map((u) => formatOne(u, style)).join('\n');
}

/**
 * ⭐ 本题目标：这里要加 'compact' 风格的实现
 *
 * compact 的输出格式： "Ada(36), Lin(28)"
 * - 多个用户用 ", " 分隔
 * - 每个用户是 名字(年龄)
 * - 空数组返回空字符串
 */
export function formatCompact(users: User[]): string {
  return users.map((u) => `${u.name}(${u.age})`).join(', ');
}
