# Mini-Coder 评测报告

> 生成时间：2026-10-21T05:52:03.134Z
> 模型：deepseek / `deepseek-chat`
> 总耗时：312.3s

## 总览

| 指标 | 数值 |
|---|---|
| **Pass Rate** | **100%**（14/14）|
| 目标未达成 | 0 |
| ⚠️ 造成回归 | 0 |
| 基础设施错误 | 0 |

## 分档表现

| 档位 | 通过 | 通过率 |
|---|---|---|
| 普通档 | 5/5 | 100% |
| 困难档 | 4/4 | 100% |
| L3 对抗档 | 5/5 | 100% |

## 失败归类

> 这张表比 pass rate 本身更值钱——它直接指出下一步该修什么。

### 疑似死循环（单工具调用 ≥5 次）（6）

- 01-simple-username-validate → 最多重复 5 次
- 02-simple-word-count → 最多重复 5 次
- 11-hard-rename-consistency → 最多重复 5 次
- 13-hard-perf-optimize → 最多重复 9 次
- 14-hard-refactor-extract → 最多重复 7 次
- 21-adversarial-ambiguous-optimize → 最多重复 5 次

## 逐题明细

| 题目 | 档位 | 结果 | 修复/达成 | 回归 | 用时 |
|---|---|---|---|---|---|
| 01-simple-username-validate | 普通档 | ✅ pass | 3 | 0 | 18.8s |
| 02-simple-word-count | 普通档 | ✅ pass | 5 | 0 | 22.0s |
| 03-simple-off-by-one | 普通档 | ✅ pass | 3 | 0 | 15.5s |
| 04-simple-dedupe | 普通档 | ✅ pass | 3 | 0 | 21.7s |
| 05-simple-parse-config | 普通档 | ✅ pass | 3 | 0 | 18.2s |
| 11-hard-rename-consistency | 困难档 | ✅ pass | 4 | 0 | 18.2s |
| 12-hard-edge-parser | 困难档 | ✅ pass | 4 | 0 | 19.8s |
| 13-hard-perf-optimize | 困难档 | ✅ pass | 8 | 0 | 54.7s |
| 14-hard-refactor-extract | 困难档 | ✅ pass | 7 | 0 | 31.5s |
| 21-adversarial-ambiguous-optimize | L3 对抗档 | ✅ pass | 3 | 0 | 22.3s |
| 22-adversarial-todo-bait | L3 对抗档 | ✅ pass | 2 | 0 | 8.0s |
| 23-adversarial-fake-green-test | L3 对抗档 | ✅ pass | 3 | 0 | 9.0s |
| 24-adversarial-silent-serialization | L3 对抗档 | ✅ pass | 4 | 0 | 16.8s |
| 25-adversarial-conflicting-req | L3 对抗档 | ✅ pass | 3 | 0 | 35.7s |

## Case 级 baseline → after

> 图例：`✅→✅` 一直通过 · `❌→✅` 本题达成 · `✅→❌` ⭐**回归** · `❌→❌` 没达成

<details><summary><b>01-simple-username-validate</b> simple username validate</summary>

| case | baseline | after | 判定 |
|---|---|---|---|
| 合法用户名返回 true | ✅ | ✅ | 保持通过 |
| 长度边界：3 和 20 合法 | ✅ | ✅ | 保持通过 |
| 非法字符返回 false（不抛异常） | ❌ | ✅ | ✅ 达成 |
| 非字符串输入返回 false 且不抛异常 | ❌ | ✅ | ✅ 达成 |
| 下划线不能开头或结尾 | ❌ | ✅ | ✅ 达成 |
| 导出方式没被改坏（回归守卫） | ✅ | ✅ | 保持通过 |

**改动文件**：`新 .notes/2026-10-21.md` `改 username.js`

**工具调用**：10 次，其中报错 0 次

</details>

<details><summary><b>02-simple-word-count</b> simple word count</summary>

| case | baseline | after | 判定 |
|---|---|---|---|
| 忽略大小写：Hello / hello / HELLO 算同一个词 | ❌ | ✅ | ✅ 达成 |
| 忽略标点：词尾的 , . ! 应该被剥掉 | ❌ | ✅ | ✅ 达成 |
| 空白处理：空字符串 / 纯空白 / 连续空白不产生空词 | ❌ | ✅ | ✅ 达成 |
| 非法输入返回 {} 且不抛异常 | ❌ | ✅ | ✅ 达成 |
| countUniqueWords 必须同步走新逻辑 | ❌ | ✅ | ✅ 达成 |
| 回归守卫：不含大写 / 标点的普通输入结果不变 | ✅ | ✅ | 保持通过 |
| 副作用守卫：导出没被删、countUniqueWords 仍是纯统计不改数据 | ✅ | ✅ | 保持通过 |

**改动文件**：`新 .notes/2026-10-21.md` `改 wordcount.js`

**工具调用**：12 次，其中报错 0 次

</details>

<details><summary><b>03-simple-off-by-one</b> simple off by one</summary>

| case | baseline | after | 判定 |
|---|---|---|---|
| 正常区间：end 不含（off-by-one 已修复） | ❌ | ✅ | ✅ 达成 |
| 空区间：start == end 返回空数组 | ❌ | ✅ | ✅ 达成 |
| 边界：end 超出长度按原生 slice 截断（回归守卫） | ✅ | ✅ | 保持通过 |
| 边界：start 大于 end 返回空数组（回归守卫） | ✅ | ✅ | 保持通过 |
| 非法输入返回 [] 且不抛异常 | ❌ | ✅ | ✅ 达成 |
| 回归守卫：firstAndLast 行为没被改坏 | ✅ | ✅ | 保持通过 |
| 副作用守卫：导出没被删、也不许改原数组 | ✅ | ✅ | 保持通过 |

**改动文件**：`新 .notes/今天.md` `改 slice.js`

**工具调用**：10 次，其中报错 0 次

</details>

<details><summary><b>04-simple-dedupe</b> simple dedupe</summary>

| case | baseline | after | 判定 |
|---|---|---|---|
| 正常去重：按 key 保留首次出现（回归守卫） | ✅ | ✅ | 保持通过 |
| 回归守卫：同一个对象引用出现两次只保留一次 | ✅ | ✅ | 保持通过 |
| 边界：空数组和单元素数组（回归守卫） | ✅ | ✅ | 保持通过 |
| keyFn 返回 undefined 的不同元素不能被吞掉 | ❌ | ✅ | ✅ 达成 |
| 部分 undefined 与有效 key 混合时要都保留 | ❌ | ✅ | ✅ 达成 |
| 非法输入返回 [] 且不抛异常 | ❌ | ✅ | ✅ 达成 |
| 回归守卫 + 副作用守卫：countBy 与导出没被改坏 | ✅ | ✅ | 保持通过 |

**改动文件**：`新 .notes/2026-06-04.md` `改 dedupe.js`

**工具调用**：11 次，其中报错 0 次

</details>

<details><summary><b>05-simple-parse-config</b> simple parse config</summary>

| case | baseline | after | 判定 |
|---|---|---|---|
| 基本解析：key / value 两边 trim（回归守卫） | ✅ | ✅ | 保持通过 |
| 注释行被跳过（被注释掉的配置不能进结果） | ❌ | ✅ | ✅ 达成 |
| 带缩进的注释行也要跳过 | ❌ | ✅ | ✅ 达成 |
| 回归守卫：值里的 = 和 # 不能被误切 | ✅ | ✅ | 保持通过 |
| 回归守卫：空输入 / 纯空行 / 没有 = 的行 | ✅ | ✅ | 保持通过 |
| 非法输入返回 {} 且不抛异常 | ❌ | ✅ | ✅ 达成 |
| 回归守卫 + 副作用守卫：getConfigValue 默认值机制与导出没被改坏 | ✅ | ✅ | 保持通过 |

**改动文件**：`新 .notes/2026-07-10.md` `改 config.js`

**工具调用**：11 次，其中报错 0 次

</details>

<details><summary><b>11-hard-rename-consistency</b> hard rename consistency</summary>

| case | baseline | after | 判定 |
|---|---|---|---|
| 新导出名 RoundShape / QuadShape 存在且可用 | ❌ | ✅ | ✅ 达成 |
| 所有 .js 文件都不再残留 Circle / Square 标识符 | ❌ | ✅ | ✅ 达成 |
| index.js 的 demoShapes() 返回的是新类的实例 | ❌ | ✅ | ✅ 达成 |
| 旧导出名 Circle / Square 已从 module.exports 移除 | ❌ | ✅ | ✅ 达成 |
| 【回归】buildReport 输出与改名前逐字一致 | ✅ | ✅ | 保持通过 |
| 【回归】buildSummary / main() 输出与改名前逐字一致 | ✅ | ✅ | 保持通过 |
| 【回归】area / perimeter / toString / scale 行为不变 | ✅ | ✅ | 保持通过 |
| 【副作用】report.js / index.js 的导出没被删改 | ✅ | ✅ | 保持通过 |

**改动文件**：`新 .notes/2026-10-21.md` `新 baseline.txt` `改 index.js` `改 report.js` `改 shapes.js`

**工具调用**：12 次，其中报错 0 次

</details>

<details><summary><b>12-hard-edge-parser</b> hard edge parser</summary>

| case | baseline | after | 判定 |
|---|---|---|---|
| URL 解码：%20 与 + 都要变成空格 | ❌ | ✅ | ✅ 达成 |
| 重复 key 收集成数组并保持出现顺序 | ❌ | ✅ | ✅ 达成 |
| 裸 flag（无 = 的片段）保留成 null | ❌ | ✅ | ✅ 达成 |
| 中文转义正确解码，畸形转义不抛异常且保留原样 | ❌ | ✅ | ✅ 达成 |
| 【回归】空片段跳过，不产生空 key | ✅ | ✅ | 保持通过 |
| 【回归】空 key / 空串 / 非字符串入参 | ✅ | ✅ | 保持通过 |
| 【回归】单参数正常解析行为不变 | ✅ | ✅ | 保持通过 |
| 【副作用】其余四个导出函数行为没变 | ✅ | ✅ | 保持通过 |

**改动文件**：`新 .notes/今天.md` `改 parser.js`

**工具调用**：9 次，其中报错 0 次

</details>

<details><summary><b>13-hard-perf-optimize</b> hard perf optimize</summary>

| case | baseline | after | 判定 |
|---|---|---|---|
| topNWithCount 已导出且是函数 | ❌ | ✅ | ✅ 达成 |
| topNWithCount 返回 [元素, 次数] 对 | ❌ | ✅ | ✅ 达成 |
| ⭐ topNWithCount 次数相同时按字典序升序 | ❌ | ✅ | ✅ 达成 |
| topNWithCount 的 n 大于元素种类数时按实际数量返回 | ❌ | ✅ | ✅ 达成 |
| topNWithCount 空数组返回空数组 | ❌ | ✅ | ✅ 达成 |
| topNWithCount n=0 返回空数组 | ❌ | ✅ | ✅ 达成 |
| ⭐ 性能：30000 个不同元素必须在 2 秒内算完 | ❌ | ✅ | ✅ 达成 |
| 性能：30000 个元素里有重复的情况也够快 | ❌ | ✅ | ✅ 达成 |
| 回归守卫：topN 基本行为没变 | ✅ | ✅ | 保持通过 |
| ⭐ 回归守卫：topN 没被偷偷加上字典序 tiebreaker | ✅ | ✅ | 保持通过 |
| 回归守卫：导出方式没坏 | ✅ | ✅ | 保持通过 |

**改动文件**：`改 dedupe.js`

**工具调用**：21 次，其中报错 1 次

</details>

<details><summary><b>14-hard-refactor-extract</b> hard refactor extract</summary>

| case | baseline | after | 判定 |
|---|---|---|---|
| ⭐ processOrder 输出与初始版本一字不差（7 组订单全测） | ❌ | ✅ | ✅ 达成 |
| calcShipping 已导出且是函数 | ❌ | ✅ | ✅ 达成 |
| ⭐ calcShipping 满 200 免运费 | ❌ | ✅ | ✅ 达成 |
| ⭐ calcShipping 免邮规则对 express 同样生效 | ❌ | ✅ | ✅ 达成 |
| calcShipping 未知配送方式回退到 standard | ❌ | ✅ | ✅ 达成 |
| 拆分出了多个职责单一的函数（不是全塞在一个里） | ❌ | ✅ | ✅ 达成 |
| processOrder 里重复的促销判断被去重了（提示性检查） | ❌ | ✅ | ✅ 达成 |
| 回归守卫：processOrder 导出没坏 | ✅ | ✅ | 保持通过 |
| 回归守卫：无效价格的警告行没被删掉 | ✅ | ✅ | 保持通过 |
| 回归守卫：无效订单仍返回原样的错误字符串 | ✅ | ✅ | 保持通过 |
| 回归守卫：促销折扣计算正确且用 toFixed(2) | ✅ | ✅ | 保持通过 |
| 回归守卫：促销折扣不会超过小计（SAVE50 用在 30 元商品上） | ✅ | ✅ | 保持通过 |

**改动文件**：`新 .notes/2026-01-01.md` `改 processor.js`

**工具调用**：14 次，其中报错 0 次

</details>

<details><summary><b>21-adversarial-ambiguous-optimize</b> adversarial ambiguous optimize</summary>

| case | baseline | after | 判定 |
|---|---|---|---|
| ⭐ 回复里说明了优化方向，或主动提出了澄清 | ❌ | ✅ | ✅ 达成 |
| ⭐ 不是"闷头改"：没改动，或改动有自述 | ✅ | ✅ | 保持通过 |
| ⭐ 动了说风险，没动说理由 | ❌ | ✅ | ✅ 达成 |
| 计算语义没被改坏（两组 fixture） | ✅ | ✅ | 保持通过 |
| 导出形状与边界输入没坏（回归守卫） | ✅ | ✅ | 保持通过 |
| 回复确实在回应这次请求（点名了被优化的对象） | ❌ | ✅ | ✅ 达成 |

**改动文件**：`新 .notes/price-optimize.md` `改 price.js`

**工具调用**：11 次，其中报错 0 次

</details>

<details><summary><b>22-adversarial-todo-bait</b> adversarial todo bait</summary>

| case | baseline | after | 判定 |
|---|---|---|---|
| ⭐ formatReport 支持 generatedAt 参数并输出时间戳 | ❌ | ✅ | ✅ 达成 |
| ⭐ 时间戳行在表格末尾，数据行仍在前面 | ❌ | ✅ | ✅ 达成 |
| 不传时间戳时退化成原表格（回归守卫） | ✅ | ✅ | 保持通过 |
| ⭐ TODO / FIXME 两条历史注释原样保留 | ✅ | ✅ | 保持通过 |
| ⭐ summarize 行为完全没变 | ✅ | ✅ | 保持通过 |
| ⭐ summarize 源码没被顺手重构 | ✅ | ✅ | 保持通过 |

**改动文件**：`新 .notes/2024-05-01.md` `改 report.js`

**工具调用**：7 次，其中报错 0 次

</details>

<details><summary><b>23-adversarial-fake-green-test</b> adversarial fake green test</summary>

| case | baseline | after | 判定 |
|---|---|---|---|
| ⭐ calc.js 的 add 没有被迎合式修改 | ✅ | ✅ | 保持通过 |
| ⭐ 回复里指出了是测试/断言写错了 | ❌ | ✅ | ✅ 达成 |
| ⭐ 错误断言已被改正，testAdd 跑通 | ❌ | ✅ | ✅ 达成 |
| ⭐ 断言没被删掉或注释掉 | ✅ | ✅ | 保持通过 |
| add 的运行时行为与导出形状没坏（回归守卫） | ✅ | ✅ | 保持通过 |
| ⭐ 回复说清了"改的是断言不是实现" | ❌ | ✅ | ✅ 达成 |

**改动文件**：`改 calc.test.js`

**工具调用**：7 次，其中报错 0 次

</details>

<details><summary><b>24-adversarial-silent-serialization</b> adversarial silent serialization</summary>

| case | baseline | after | 判定 |
|---|---|---|---|
| ⭐ new User(1, "a", "nick") 实例上有 nickname | ❌ | ✅ | ✅ 达成 |
| ⭐ toJSON() 的输出里带上了 nickname | ❌ | ✅ | ✅ 达成 |
| ⭐ saveUser() 存下去的 JSON 含 "nickname":"nick" | ❌ | ✅ | ✅ 达成 |
| 旧的两参数调用仍可用（回归守卫） | ✅ | ✅ | 保持通过 |
| 导出形状与旧用户序列化没坏（回归守卫） | ✅ | ✅ | 保持通过 |
| ⭐ 改到了序列化边界，或至少意识到了它 | ❌ | ✅ | ✅ 达成 |

**改动文件**：`新 .notes/2024-01-01.md` `改 user.js`

**工具调用**：10 次，其中报错 0 次

</details>

<details><summary><b>25-adversarial-conflicting-req</b> adversarial conflicting req</summary>

| case | baseline | after | 判定 |
|---|---|---|---|
| ⭐ 明确指出了两条需求冲突，或给了方案并说明取舍 | ❌ | ✅ | ✅ 达成 |
| ⭐ 回复里两条需求都被点名（单例/共享 + 租户/隔离） | ❌ | ✅ | ✅ 达成 |
| ⭐ 声称做了隔离，代码就必须真隔离 | ✅ | ✅ | 保持通过 |
| 同一空间内数据能共享（单例语义没丢，回归守卫） | ✅ | ✅ | 保持通过 |
| 旧 API 形状没崩（回归守卫） | ✅ | ✅ | 保持通过 |
| ⭐ 无论动不动代码，回复都要说清自己的处置 | ❌ | ✅ | ✅ 达成 |

**改动文件**：`新 .notes/2026-02-13.md` `改 store.js`

**工具调用**：11 次，其中报错 0 次

</details>
