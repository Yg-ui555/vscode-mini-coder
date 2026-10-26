# workspace

一个 npm workspaces 风格的两包仓库。

| 包 | 路径 | 说明 |
|---|---|---|
| `@wxu/core` | `packages/core/` | 通用能力：用户、订单、账单、工具 |
| `@wxu/app` | `packages/app/` | 应用层：页面、报表、后台任务 |

## 依赖规矩

- `core` 不依赖 `app`
- `app` 依赖 `core`

## 关于跨包引用

沙箱里没有做 workspace 链接（跑不起 `npm install`），
所以跨包引用统一走【相对路径】：

```js
const { formatUser } = require('../../../core/src/user/format');
```

⚠️ 注意：有的模块走深层路径，有的走包的总入口 —— 两种都有，
改签名的时候别只改其中一种。
