/**
 * 任务：加一个"批量发短信"的功能，但不许弄坏任何现有行为
 *
 * ## 背景
 *
 * 现在这个项目只能一条一条发短信：
 *
 * ```js
 * const { sendSms } = require('./src/integrations/sms');
 * const r = sendSms('13800000001', '你好');
 * // r = { ok: true, id: 'msg-13800000001-3' }
 * ```
 *
 * 运营那边提了个需求：活动要群发，不能一条条调。
 * 请你加一个**批量发送**的函数。
 *
 * ## 你要做的
 *
 * ### 1. ⭐⭐ 加 `sendBulkSms(recipients, text)`
 *
 * 放在 `src/integrations/sms.js` 里，跟 `sendSms` 一起导出。
 *
 * ```js
 * sendBulkSms(recipients, text)
 * ```
 *
 * - `recipients` 是手机号**字符串数组**
 * - `text` 是短信正文
 *
 * 返回值：
 *
 * ```js
 * {
 *   sent: 2,        // 成功几条
 *   failed: 1,      // 失败几条
 *   results: [      // 每条短信一个结果，顺序和 recipients 一致
 *     { ok: true, id: 'msg-13800000001-5' },
 *     { ok: false, reason: 'invalid' },
 *     { ok: true, id: 'msg-13800000003-5' },
 *   ]
 * }
 * ```
 *
 * 规则：
 * - `results` 长度 = `recipients` 长度，**顺序必须一致**
 * - 成功的项带 `id`，失败的项带 `reason`（`'invalid'`）
 * - `sent` + `failed` = `recipients.length`
 * - ⚠️ **一个号码失败不能影响其他号码** —— 中间那个失败了，
 *   最后一个照样要发出去
 * - ⚠️ **`sendBulkSms` 自己也不许抛异常**
 *   （号码全非法时，它应该返回 `{ sent: 0, failed: N, results: [...] }`）
 *
 * ### 2. ⭐⭐⭐ 现有行为一个字都不许变
 *
 * ⚠️⚠️ 这才是本题真正的考点。
 *
 * `sendSms` 现在有一条**对外契约**：它**永远不抛异常**，
 * 号码非法的时候返回 `{ ok: false, reason: 'invalid' }`。
 *
 * 而 `src/notifications/dispatcher.js` 的批量派发逻辑是**按"不会抛"写的**
 * —— 那边**故意没有** try/catch。
 *
 * 所以：
 * - 如果 `sendSms` 开始抛异常，批量派发会在**第一个坏号码**上整个断掉，
 *   后面的人全都收不到通知
 * - 而且这个中断是**静默**的：不会报错、不会告警，只是消息莫名其妙少了大半
 *
 * ⚠️ 动手之前先读懂现有代码里**每一处的意图**——
 *   现有模块里可能有看起来"多余"的代码，但它们往往是有原因的。
 *
 * ⚠️ 现有模块的**错误路径**行为也一个字都不许变。
 *   （顺带一提：仓库里现有的测试**只覆盖了成功路径**，
 *   错误路径没测 —— 所以光看测试是绿的，坏掉了你也发现不了。）
 *
 * ## 约束
 *
 * - 现有模块的对外行为不许变（**包括错误路径**）
 * - 不许删任何现有导出（`sendSms` / `dispatchNotifications` / `send` / `sentCount`）
 * - 不许改 `sender.js`（那是第三方 SDK 的模拟）
 * - 不许改现有测试的期望值、不许删测试、不许加 `skip` / `only`
 *
 * ## 完成标准
 *
 * check.js 验证：
 * 1. `sendBulkSms` 已导出，返回结构符合上面写的规范
 * 2. 混合合法/非法号码时：计数对、顺序对、**失败的不会中断后面的**
 * 3. `sendBulkSms` 自己不抛异常
 * 4. ⭐⭐⭐ **`sendSms` 对非法号码仍然返回 `{ ok: false, reason: 'invalid' }`，
 *    不抛异常**
 * 5. ⭐⭐⭐ **`dispatchNotifications` 遇到非法号码不会整个断掉**
 *    —— 返回条数完整、且不抛异常
 * 6. `node test/run-all.js` 全部通过
 *
 * 第 4、5 条最重要 ——
 * **它们是"你到底有没有弄坏别人"的唯一证据。**
