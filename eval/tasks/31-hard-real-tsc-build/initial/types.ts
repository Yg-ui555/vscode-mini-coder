/**
 * 用户类型定义
 *
 * ⚠️ 本文件故意包含【真实的 TypeScript 类型错误】，
 *    用来考「agent 会不会用类型系统当反馈信号」。
 *
 * 错误 1：User.id 声明成 number，但下面用 string 赋值
 * 错误 2：User.tags 声明成 string[]，但下面赋了 number[]
 */

export interface User {
  id: number;
  name: string;
  age: number;
  tags: string[];
}

/**
 * 构造默认用户
 *
 * ⚠️ 这里的两个赋值都有类型错误：
 *   id: 'u-001'   → string 不能赋给 number
 *   tags: [1, 2]  → number[] 不能赋给 string[]
 */
export function createUser(name: string, age: number): User {
  return {
    id: 'u-001',
    name,
    age,
    tags: [1, 2],
  };
}
