# job-runner

一个"跑任务"的极简执行器：注册一堆 job kind，按 kind 分发执行。

```bash
node index.js --list-kinds     # 列出当前注册的所有 job kind
node index.js --run <kind>     # 用默认输入跑一个 job
```

## 目录结构

| 目录 | 放什么 |
|---|---|
| `src/core/` | 执行器内核：注册表、加载器、结果契约 |
| `src/handlers/` | 内置 job 实现，按业务域分子目录 |
| `src/adapters/` | 外部系统适配层 |
| `src/pipeline/` | 组合多个 job 的流程编排 |
| `src/util/` | 无状态的小工具 |

## 结果契约

`src/core/contract.js` 定义了所有 job 的返回约定：

```js
const { ok, fail } = require('./src/core/contract');

function run(input) {
  if (!input) return fail('缺少 input');
  return ok({ total: 42 });
}
```

调用方（pipeline / adapters）只认这一种形状。
