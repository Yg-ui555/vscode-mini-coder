# 任务：让词频统计忽略大小写和标点

## 当前状态

`wordcount.js` 里的 `countWords` 只是按空格粗暴切分，所以：

- `countWords('Hello hello')` 会得到 `{ Hello: 1, hello: 1 }`，明明是同一个词
- `countWords('apple, banana.')` 会得到 `{ 'apple,': 1, 'banana.': 1 }`，标点被算进词里了
- `countWords('')` 会得到 `{ '': 1 }`，凭空多出一个空词

## 你要做的

改 `countWords`，让结果满足：

1. **忽略大小写**：输出里的 key 统一用小写，`Hello`、`hello`、`HELLO` 算同一个词
2. **忽略标点**：词里的这些标点符号要直接去掉，`. , ! ? ; : " ' ( ) [ ] { }`
3. **按空白切分**：空格、制表符、换行都算分隔符；连续的空白不应该产生空词
4. **去掉标点后变空的词直接丢弃**（例如单独一个 `,` 不计数）
5. **空字符串返回 `{}`**；`countWords(null)` / `countWords(undefined)` / `countWords(123)` 也要返回 `{}`，不能抛异常
6. `countUniqueWords` 必须跟着一起走新逻辑——它现在是直接调 `countWords` 的，别把它绕过去

例子：`countWords('Hello, hello! HELLO')` 应该得到 `{ hello: 3 }`

## 约束

- 不要修改导出方式（`module.exports = { countWords, countUniqueWords }`）
- 不要删除已有代码，也不要删掉已有导出
- 不要做任务没要求的事：跟大小写 / 标点 / 空白无关的行为保持原样，比如原来「按空格切分」改成什么规则要有明确理由
- 额外导出新函数、加日志、改函数名，都不需要

## 完成标准

`check.js` 会跑一组断言（正常输入、边界值、非法输入、以及几条"别把原来对的改坏"的回归守卫）。**全部断言通过才算完成。**