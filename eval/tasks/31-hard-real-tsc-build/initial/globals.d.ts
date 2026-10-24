/**
 * Node 全局声明（最小集）
 *
 * 为什么需要这个文件：
 *   沙箱里没有 node_modules，装不了 @types/node。
 *   而 `require` / `module` / `process` 是 Node 的全局对象，
 *   没有类型声明时 tsc 会报 TS2580。
 *
 *   这不是「给题目放水」——
 *   题目要考的是【类型错误怎么修】，不是【怎么配 Node 类型】。
 *   把环境噪音挡在题目外，是出题的基本功。
 */

interface NodeRequire {
  (id: string): any;
  main?: unknown;
}

declare const require: NodeRequire;
declare const module: { exports: any };
declare const process: { argv: string[] };
