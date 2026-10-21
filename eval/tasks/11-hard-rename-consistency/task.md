# 任务：跨文件重命名 `Circle` / `Square`

## 当前状态

这是一个三文件的小模块：

| 文件 | 职责 |
| --- | --- |
| `shapes.js` | 定义 `Circle`、`Square` 两个类，导出 |
| `report.js` | 依赖 `Circle` / `Square`，生成报表与汇总 |
| `index.js` | 依赖上面两个文件，跑示例流程 |

现在要把类名统一改成更准确的叫法：

- `Circle` → **`RoundShape`**
- `Square` → **`QuadShape`**

## 你要做的

重命名必须**贯穿全部三个文件**，具体包括下面这些位置：

1. `shapes.js` 里的 `class Circle` / `class Square` 声明
2. `shapes.js` 里的自引用：`Circle.prototype` 场景下的 `new Circle(...)`（在 `scale()` 方法里）
3. `shapes.js` 的导出：`module.exports = { Circle, Square }` 要变成 `module.exports = { RoundShape, QuadShape }`
4. `report.js` 顶部解构：`const { Circle, Square } = require('./shapes')` 要改成新名字
5. `report.js` 里 `buildFromNames()` 中的 `new Circle(...)` / `new Square(...)`
6. `index.js` 顶部解构 require
7. `index.js` 里 `demoShapes()` 中的 `new Circle(1)` / `new Square(2)` / `new Circle(3)`

**旧名字要彻底消失**：改完之后，沙箱目录下所有 `.js` 文件的内容里都不允许再出现 `Circle` 或 `Square` 这两个词（注释里也不行，不要写「把 Circle 改成了 RoundShape」这种注释）。

## 硬约束（这几条比改名本身更重要）

- **行为一个字都不能变**。`main()`、`buildReport()`、`buildSummary()`、`area()`、`perimeter()`、`toString()`、`scale()` 的输出必须和改名前逐字相同。
- **不要改字符串字面量**。`'circle'` / `'square'` 是对外的业务标签（会出现在报表和 `toString()` 里），跟类名是两回事，保持小写原样。
- **不要改任何输出格式**。`buildReport()` 生成的 `count=3` / `total=35.41` / `#1=3.14` 这类文本、`buildSummary()` 生成的 `summary(3) circle:2,square:1` 都必须原样保留。
- **不要新增或删除文件**，也不要改变 `require` 的依赖关系。

## 完成标准

`check.js` 会断言：新类名可用、三个文件里没有旧名字残留、并且上面列出的所有输出和改名前逐字一致。全部通过才算完成。