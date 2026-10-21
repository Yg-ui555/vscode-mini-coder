# 任务：把 `legacyFormat` 的调用点全部迁到 `formatMoney`

## 仓库结构

```
index.js                 入口，把四个模块的输出拼起来
src/format.js            金额格式化，老函数 legacyFormat + 新函数 formatMoney 并存
src/checkout.js          用了 legacyFormat
src/pricing.js           用了 legacyFormat
src/reports/invoice.js   用了 legacyFormat
src/reports/legacy-html.js  ⚠️ 名字里有 legacy，但【跟金额格式化无关】，不要动
```

## 你要做的

把 `legacyFormat` 的**全部调用点**迁移到同文件里的 `formatMoney`，然后从 `src/format.js` 的导出表里删掉 `legacyFormat`。

调用点分散在三个文件里，而且**任务描述没有列出完整清单**——你要自己在仓库里搜出来，一个都不能漏。

## 硬约束

- **输出必须逐字不变**。`index.js` 的 `main()` 返回值在迁移前后必须完全相同（金额字符串、下划线分隔符、HTML 表格都算）。
- **不要改 `src/reports/legacy-html.js`**。它的文件名里有 "legacy"，很容易被搜索命中，但它做的是 HTML 表格渲染，跟 `format.js` 没有任何共用代码。它也**不需要**改用 `formatMoney`——它输出的是不带 `¥` 的裸数字，和这两个函数不是一回事。
- **不要新增或删除文件**，不要改变 `require` 的依赖关系。
- 导出表最终应恰好剩下 `formatMoney` 一个。

## 项目规约：怎么查找符号引用

**在这个仓库里查找某个符号在哪里被引用，一律使用 `grep` 工具**，不要靠 `list_dir` + 逐个 `read_file` 把所有文件读一遍。

这条是硬性要求，会被检查。你只有 6 个文件，读一遍确实能"找到"，但那正是我们要避免的工作方式——真实仓库有几千个文件时，逐个读是不可行的。

## 完成标准

`check.js` 会断言：`legacyFormat` 已从导出表移除、三个调用点都已改用 `formatMoney`、你确实用过 `grep`、以及所有输出逐字不变且 `legacy-html.js` 一个字节都没被碰过。

> 这道题在考什么：**"我搜到了没有"和"我改对了没有"是两个独立的能力。**
> 大多数 agent 在只有 3 个文件时会靠遍历侥幸找到全部调用点，
> 换个 300 文件的仓库就漏掉一半，漏掉的那个调用点会静默地继续跑老逻辑——
> 代码能跑、测试也过、看起来万事大吉，但迁移其实是**半成品**。
> 这道题把"必须先搜"写进规约里，就是在测这个能力有没有被内化。