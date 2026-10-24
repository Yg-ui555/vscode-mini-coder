/**
 * 任务：改掉内部记录结构，但对外 API 不能变
 *
 * ## 背景
 *
 * 这个项目里有一条"记录"（record），现在内部长这样：
 *
 * ```js
 * { id: 'r-1', name: 'Alpha', ownerId: 'u-7', status: 'open' }
 * ```
 *
 * 也就是说：**负责人只是一个 id 字符串**，谁叫什么都查不到。
 *
 * 产品提了个需求：列表页要显示负责人的**姓名**，
 * 让后端把 `ownerId` 换成完整的 owner 对象，顺便把 `name` 改成 `title`
 * （`name` 太笼统了，owner 也有 name，容易混淆）。
 *
 * ## 新的内部结构（你要实现的）
 *
 * ```js
 * {
 *   id: 'r-1',
 *   title: 'Alpha',
 *   status: 'open',
 *   owner: { id: 'u-7', name: '张伟' }
 * }
 * ```
 *
 * 具体规则：
 *
 * - `name` → `title`
 * - `ownerId: 'u-7'` → `owner: { id: 'u-7', name: '张伟' }`
 *   （owner 的姓名从 `records.js` 里已有的 `OWNERS` 表查）
 * - `status` 保持不变
 * - ⚠️ **找不到 owner 时**（ownerId 不在 `OWNERS` 里）：
 *   `owner` **不是 null**，而是 `{ id: <原来的 ownerId>, name: 'unknown' }`
 *   —— 也就是 owner 的 id 照旧，姓名用 `unknown`
 *
 * ## 你要做的
 *
 * ### 1. ⭐ 改数据源
 *
 * `src/records.js` 的 `findRecord` / `listRecords` 要返回新结构。
 *
 * ### 2. ⭐ 找出并改掉所有读旧字段的地方
 *
 * 项目里有**三个模块**读了这几个字段：
 *   · `src/format.js` —— 格式化一条记录
 *   · `src/list.js`   —— 渲染整个列表
 *   · `src/api.js`    —— 转成对外 API 的 payload
 *
 * ⚠️ **它们踩的坑不一样**：
 *   · `list.js` 里有**两条**依赖路径 —— 一条是调用 `formatRecord`（间接），
 *     一条是排序时自己读了字段（直接）。只改一条，另一条照样错。
 *   · `format.js` 是最直接的一处。
 *   · `api.js` 最容易改错 —— 见下面第 3 条。
 *
 * 请用 grep 工具**自己找**，不要靠猜。
 *
 * ### 3. ⭐⭐ 对外 API 的形状一个字都不许变
 *
 * `src/api.js` 的 `toApiPayload` 对外返回的一直是：
 *
 * ```js
 * { id: 'r-1', title: 'Alpha', ownerId: 'u-7' }
 * ```
 *
 * ⚠️⚠️ **外部系统依赖这个形状，不能跟着内部改动一起变。**
 *
 * 内部结构改了，但对外输出必须**一模一样** ——
 * 包括 `ownerId` 查不到 owner 的那条记录，对外仍然是 `ownerId: 'u-404'`，
 * **不能变成 null、也不能变成 undefined**。
 *
 * 所以 `api.js` 只是"取值的来源"变了，"取的字段"没变。
 *
 * ### 4. ⭐ 更新三个测试文件的期望值
 *
 * ⚠️ 这道题和别的题不一样：**测试的期望值确实要改**，
 * 因为对外行为真的变了（列表里显示的是姓名而不是 id）。
 *
 * 但：
 * - `test/api.test.js` 的期望值**一个字都不许改**（对外契约没变）
 * - 不能删测试、不能加 `skip` / `only`
 *
 * ## 约束
 *
 * - **对外 API 的输出必须和改之前完全一致**
 * - 不许删任何模块、任何导出
 * - 不许改 `OWNERS` 表的内容
 * - 不许改 `status` 字段的语义
 * - `findRecord` 查不到记录时仍然返回 `null`
 * - `findRecord` / `listRecords` 必须继续返回**副本**，
 *   不能把仓库里的原始对象直接暴露出去（调用方一改就污染了仓库）
 * - 测试文件不许删测试、不许加 `skip` / `only`
 *
 * ## 完成标准
 *
 * check.js 验证：
 * 1. `findRecord` / `listRecords` 返回新结构
 * 2. `formatRecord` 的输出变成了 `'<title> by <owner 姓名>'`
 * 3. `renderList` 按 title 升序，且输出正确
 * 4. owner 查不到时 `owner` 是 `{ id: 'u-404', name: 'unknown' }`
 * 5. ⭐ **`toApiPayload` 的对外输出和改之前完全一样**
 * 6. `node test/run-all.js` 全部通过
 *
 * 第 5 条最重要 —— 它是"内部改了、外部没改"的唯一证据。
