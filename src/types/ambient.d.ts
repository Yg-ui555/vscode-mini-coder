/**
 * 全局 ambient 声明
 *
 * 让 TypeScript 别管 Vitest 的 ?mocked / ?raw / ?url 等查询后缀导入。
 * 这些后缀是 Vitest（Vite 解析器）识别的，但 tsc 默认的 node10 解析不认。
 * 如果不声明，tsc 编译失败，但 vitest run 能过。
 */

declare module '*?mocked' {
  const m: any;
  export = m;
}

declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*?url' {
  const url: string;
  export default url;
}