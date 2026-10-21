# 任务：给 `parseQuery` 补齐边界处理

## 当前状态

`parser.js` 里的 `parseQuery` 能处理最简单的 `a=1&b=2`，但下面这些真实场景全是错的：

```js
parseQuery('name=%E4%B8%AD');      // 现在返回 '%E4%B8%AD'，应该是 '中'
parseQuery('q=hello+world');       // 现在返回 'hello+world'，应该是 'hello world'
parseQuery('a=1&a=2');             // 现在返回 '2'，应该返回 ['1', '2']
parseQuery('flag&a=1');            // 现在把 flag 丢了，应该保留成 { flag: null, a: '1' }
```

## 你要做的

在**不改变已有正确行为**的前提下，给 `parseQuery` 加上下面 6 条规则：

### 1. URL 解码

key 和 value 都要做 URL 解码：

- `%20` → 空格（一个）
- `+` → 空格
- `%E4%B8%AD` → `中`

**解码顺序很重要**：先把字符串里的 `+` 全部替换成空格，再调 `decodeURIComponent`。顺序反了会把 `%2B`（本意是字面量 `+`）错误地变成空格。

### 2. 畸形转义不能抛异常

像 `a=%E4` 这种残缺的百分号序列，`decodeURIComponent` 会抛 `URIError`。这时候**保留原始字符串**（`'%E4'`），不能抛异常，也不能返回 `undefined`。

### 3. 重复 key 收集成数组

同一个 key 出现多次时，收集成数组，并且**保持出现顺序**：

```js
parseQuery('a=1&a=2');        // { a: ['1', '2'] }
parseQuery('a=1&a=2&a=3');    // { a: ['1', '2', '3'] }
```

只出现一次的 key 仍然是字符串，不是数组。

### 4. 裸 flag 保留成 null

没有 `=` 的**非空**片段，要把该 key 的值记成 `null`：

```js
parseQuery('flag&a=1');       // { flag: null, a: '1' }
parseQuery('a');              // { a: null }
```

如果这个 key 之前已经出现过值，要把 `null` 并进数组（顺序在后面）：

```js
parseQuery('a=1&a');          // { a: ['1', null] }
parseQuery('a&a=1');          // { a: [null, '1'] }
```

### 5. 空片段直接跳过

连续 `&`、开头结尾的 `&` 会产生空字符串片段，**必须跳过**，不能变成 `{ '': null }`：

```js
parseQuery('a=1&');           // { a: '1' }
parseQuery('a=1&&b=2');       // { a: '1', b: '2' }
parseQuery('&&&');            // {}
parseQuery('flag&&a=1');      // { flag: null, a: '1' }
```

### 6. 空 key 照常处理

`=5` 这种 key 为空的片段，key 就是空字符串：

```js
parseQuery('=5');             // { '': '5' }
```

## 硬约束

- **不要改这几个函数的签名和导出方式**，`module.exports` 保持原样。
- **`stringifyQuery` / `countPairs` / `splitPairs` / `parseQuerySafely` 不许改**。它们是别的模块在用的，改了会出事。
- 已有正确的行为不能变：`parseQuery('a=1')` 必须还是 `{ a: '1' }`。
- `parseQuery('')` / `parseQuery(null)` / `parseQuery(undefined)` 仍然返回 `{}`。
- 不要引入第三方依赖。

## 完成标准

`check.js` 会覆盖正常路径、边界（空片段 / 空 key / 畸形转义 / 中文转义）、重复 key、裸 flag，以及对另外四个函数的回归断言。全部通过才算完成。