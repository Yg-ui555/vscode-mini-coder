# handler-service

一个很朴素的 HTTP 服务：每个 handler 一个文件，handler 之间基本不互相依赖。

## 目录结构

```
src/core/user-id.js   用户显示名的统一格式化
src/handlers/          各个业务 handler，一个文件一个 handler
```

## 开发

- 新增 handler 就新建 `src/handlers/<业务>-<序号>.js`，导出一个 `handle` 函数。
- `src/core/user-id.js` 里的 `formatUserId` 是公共的，谁要用就 require 它。
- 没有构建步骤。改完用 `node -e "require('./src/handlers/user-01.js')"` 能加载就说明语法没问题。
- 新 handler 的编号接着往后排，不要重号。
