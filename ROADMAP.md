# vscode-mini-coder · Agent 工程化路线图

> 生成时间：2026-10-24
> 基于对 `vscode-mini-coder`（TypeScript，VS Code 插件）、`goose-main`（Rust，Block）、`nanobot-main`（Python，HKUDS）三个项目的完整代码阅读。
> 目标：把本项目从"功能完整的插件"升级为"可写进 agent 岗位简历的工程作品"。

---

## 零、先说结论（如果你只读一节，读这节）

你现在这个项目**底子比 95% 的学生 agent 项目强**，但它有一个致命结构性问题：

> **你的项目和 goose / nanobot 的差距，不在"功能多少"，而在"能不能被测量"。**

具体说：

- goose 有 200 万行 Rust，nanobot 有 30 多万行 Python，你只有 1.5 万行 TypeScript。**功能上你永远追不上**。
- 但 goose 的价值不在功能多，在于它有一套**"每一步都能被断言"的架构**（状态机 + Effect 落盘 + 快照测试）。
- 你的 `eval/` 框架已经在做这件事了，而且是三个项目里**唯一一个把"回归"（agent 把对的改坏了）当成一等公民**的。这是真本事，但目前只用在"评测题目"上，没有用到"产品代码"上。

**所以核心判断是：**

1. **不要去追 MCP、子智能体、30 个 Provider** —— 那是 nanobot/goose 的体量活，你 3-6 个月做不完，做完了也不加分（因为抄得太像反而没辨识度）。
2. **要做的是"把测量能力贯穿全生命周期"** —— 每一个能力上线，都必须能回答"它让 pass rate 变好了还是变差了？花了多少 token？引入了多少回归？"
3. **简历上真正能打动 agent 岗面试官的不是"我实现了多少功能"，而是"我建立了一套怎么知道自己做得对不对的体系"。**

这套叙事逻辑，恰好是绝大多数候选人拿不出来的。校招 agent 岗的人里，90% 只能说"我调用了 LangChain / 我用 Coze 搭了个 agent"。**你能说"我给 agent 建了带回归检测的评测基线，发现并修掉了 3 个 400 级协议 bug"** —— 这就是差异化。

---

## 一、项目现状体检（基于实际代码，不是基于 PROJECT.md 的自述）

### 1.1 客观事实

| 项 | 实测值 | 证据 |
|---|---|---|
| 源码规模 | 约 15,500 行 TS（含 4,825 行测试） | `src/` 全量统计 |
| 测试用例 | 340 个，**338 通过 / 2 失败** | 实跑 `npx vitest run` |
| 测试耗时 | 78.9 秒 | 同上 |
| 工具数量 | 9 个 | `src/agent/tools/factory.ts:38-57` |
| 评测题量 | 18 道（5 普通 / 6 困难 / 7 对抗） | `eval/tasks/` |
| 最近评测成绩 | 94%（17/18），¥2.48，108 万 token | `eval/RESULTS.md` |
| Git 提交 | 17 个提交，最近 2026-10-23 | `git log` |
| 远程仓库 | 已推到 GitHub（`Yg-ui555/vscode-mini-coder`） | `git remote -v` |

### 1.2 ⚠️ 我发现的 4 个真实问题（这些必须先修）

#### 问题 1：测试套件有 2 个失败，而且是"铁律"测试

```
× evalFramework.test.ts > baseline 设计铁律 > 每题至少 2 个 case 在初始代码上通过
× evalFramework.test.ts > baseline 设计铁律 > 每题至少 1 个 case 在初始代码上失败
  → Test timed out in 5000ms.
```

**根因**：`vitest.config.mts:11-32` 没有配置 `testTimeout`，vitest 默认 5000ms。而这两个测试要真跑 18 道题的 `check.js`，实测耗时 6517ms / 10700ms。

**为什么这个必须先修**：这是**你项目里最核心的两条设计铁律**的守卫测试。它们失败意味着"评测集的基础约束正在失守"，而你根本不知道 —— 因为 CI 是红的，只是没人看。

**修法**（5 分钟）：

```ts
// vitest.config.mts
test: {
  // ...
  testTimeout: 30_000,   // 评测铁律测试要跑完 18 道题的 check.js
  hookTimeout: 30_000,
}
```

**顺带建议**：这两个测试慢的根因是**它们同步跑完了全部 18 道题**。更好的做法是让它们只检查题目的**静态结构**（数一数 `check.js` 里有几个 case、跑一遍 baseline 拿通过数），而不是每次全量执行。

---

#### 问题 2：评测数据已经过期，结论不再成立

```
eval/results.json   最后修改  2026-10-21 19:20
src/agent/loop.ts   最后修改  2026-10-22 18:36   ← 比评测晚一天
src/agent/toolOutputStore.ts  2026-10-22 15:01
src/skills/loader.ts           2026-10-22 15:26
src/session/resume.ts          2026-10-22 18:38
src/util/historyRepair.ts      2026-10-22 15:07
```

**也就是说：94% 这个数字，是 10-22 那轮大加固（技能包 / 大输出外置 / 中断续跑 / 历史自愈 / 改动预览）之前测出来的。**

那轮加固动了 `loop.ts` 的核心逻辑（`maybeCompact` 的分组保护、中断补齐），但**一次评测都没重跑**。

**这在简历上是致命的**。如果你写"pass rate 94%"，面试官问"这个数字是什么时候测的？改了哪些代码之后测的？"，你答不上来。

**修法**：

```bash
npm run eval --dry     # 先验证框架链路（不花钱）
npm run eval           # 真跑，约 ¥2.5，6 分钟
```

然后把新结果提交进 git，**在 commit message 里写清楚"本次评测对应的代码 commit 是 xxx"**。这一条小动作，能让"94%"这个数字从"可能是吹的"变成"可追溯的"。

---

#### 问题 3：`agentVisible` 字段是个半成品（做了 80% 却没用上）

`src/session/store.ts:66` 定义了 `agentVisible?: boolean`，`:200` 会存盘，`:242` 会读回。

但是——**全项目没有任何一处代码把消息的 `agentVisible` 设为 `false`**。grep 全文只有这 4 处，全是"存"和"读"，没有"设"。

而 `src/agent/loop.ts:38-45` 的注释里已经明确写下了这个待办：

> 2) 【visibility flag 而非原地重排】
>    goose 的做法（context_mgmt/mod.rs:89-226）：压缩时不删任何消息，
>    只翻 agentVisible 标记 —— 摘要对模型可见、原文对模型不可见但用户
>    仍能在 UI 里滚动查看。好处是"用户看到的"和"模型看到的"解耦。
>    当前实现是原地重排 messages，用户看不到被压缩掉的历史。

**比喻**：你现在是把一本厚的笔记本**撕掉前半本**给模型看，而 goose 是给模型看一份**摘要 + 完整索引**，笔记本本身还完整躺在桌上，用户随时能翻。

**这是 Phase 1 里性价比最高的一项**（下面详述）。

---

#### 问题 4：`concurrentSafe` 字段也是半成品

`src/agent/tools/meta.ts:48-52` 定义了 `concurrentSafe`，`readOnlyMeta(concurrentSafe = true)` 默认给只读工具开了 true。

但 `src/agent/loop.ts:232-321` 的工具执行是**严格串行**的：`for` 循环里一个一个 `await`。grep 全文没有任何 `Promise.all`。

**后果**：AI 一次返回 3 个只读工具（read_file + grep + list_dir），就得等三个**串行**跑完。而这三个操作彼此毫无依赖 —— grep 一个大仓库可能要 1-2 秒。

nanobot 用 `asyncio.gather` + 按 `concurrency_safe` 分批来做这件事（`nanobot/agent/tools/execution.py:82-108`）；goose 用 `futures::stream::select_all`（`crates/goose/src/agents/state_machine/ops_toolcalling.rs:1010-1044`）。

**这就是"你已经把钥匙孔钻好了，只差把门装上"**。

---

### 1.3 你已经做对的东西（不要动，这是你的护城河）

我读完三个项目后，必须明确告诉你：**下面这些东西是你做得比两个参考项目都好的地方，别在追赶的路上把它们改烂。**

| 能力 | 你的实现 | goose | nanobot | 评价 |
|---|---|---|---|---|
| **回归检测（baseline→after 三方比对）** | `src/eval/runner.ts:209-282` | ❌ 无 | ❌ 无 | **你独有的** |
| **协议层自愈（孤儿 tool_call）** | `src/util/historyRepair.ts` | ❌ 无 | ❌ 无 | **你独有的** |
| **中断续跑 + 副作用不重复原则** | `src/session/resume.ts:215-263` | ❌ 无 | 部分 | **你更严谨** |
| **写前审批 + 写后回滚（checkpoint）** | `approval.ts` + `checkpoint/store.ts` | 有权限，无回滚 | 有权限，无回滚 | **你独有的组合** |
| **改动 diff 预览** | `util/diff.ts` + `approval.ts:284-328` | ❌ 无 | ❌ 无 | **你独有的** |
| **评测集自带标准答案** | `eval/oracles/*.solution.js` | ❌ 无 | ❌ 无 | **你独有的** |
| **权限档位设计取舍的判断力** | `approval.ts:24-32` 明确拒绝 LLM-as-judge | 有 LLM judge | 无 | **你比 goose 更清醒** |

> `approval.ts:24-32` 那段注释写得非常好：
> > ⚠️ 为什么不学 goose 的 LLM-as-judge 权限判定……慢——每个工具调用多一次完整 LLM 往返；烧钱；判不准——它也只是猜，而猜错的方向恰恰是最危险的方向。
>
> **这是一个能直接写进简历"技术判断"栏的内容。** 面试时讲"我研究过 goose 的 LLM-as-judge 方案并主动放弃了，理由是 X/Y/Z"，比讲"我实现了权限分级"高一个档次。

---

## 二、能力差距总表

> 「TS 行数」是按一个熟练 TS 开发者、基于你现有代码估算。
> 「价值」列是针对**投 agent 应用岗**这一具体目标的判断，不是通用工程价值。

| # | 能力 | goose 怎么做 | nanobot 怎么做 | 你有没有 | TS 行数 | 价值 | 优先级 |
|---|---|---|---|---|---|---|---|
| A1 | **双可见性（用户看 / 模型看解耦）** | `goose-provider-types/.../message.rs:828-834` | — | 半个（有字段无逻辑） | 60-100 | **极高** | P0 |
| A2 | **并行工具调用** | `ops_toolcalling.rs:1010-1044` | `tools/execution.py:82-108` | ❌（有字段无逻辑） | 60-100 | **极高** | P0 |
| A3 | **重复调用检测** | ❌ | `tools/file_state.py:80-97` + `utils/runtime.py:93-131` | ❌ | 100-150 | **极高** | P0 |
| A4 | **Prompt 快照测试** | `prompt_manager.rs:424/440/461`（insta） | — | ❌ | 80-120 | **极高** | P0 |
| A5 | **脚本化假 Provider（可重放评测）** | `tests/dummy_api.rs` | — | ❌（只有 mock provider 用于单测） | 100-150 | **高** | P1 |
| A6 | **Hook 生命周期机制** | `hooks/mod.rs:55-68`（12 个点） | `agent/hook.py:67-156`（18 个点） | ❌（autoTest 是硬编码的） | 200-350 | **高** | P1 |
| A7 | **Provider 熔断降级** | — | `providers/fallback_provider.py:461-560` | ❌ | 150-220 | **高** | P1 |
| A8 | **Todo / 计划模式** | `platform_extensions/todo.rs` | — | ❌ | 100-150 | **高** | P1 |
| A9 | **上下文预算（按实测 usage 触发）** | `context_mgmt/mod.rs:32-44` | `context_governance.py:414-447` | 半个（按窗口 70% 估算） | 150-250 | 中高 | P1 |
| A10 | **用户中途插话（steering）** | `ops_steer.rs:60-97` | — | ❌ | 80-120 | 中高 | P2 |
| A11 | **子智能体（独立 context）** | `platform_extensions/summon.rs:45-57` | `agent/tools/subagent.py:94-123` | ❌ | 250-400 | 中高 | P2 |
| A12 | **Op 化状态机** | `goose-agent/src/machine.rs:121-226` | `runner.py` / `loop.py` 分层 | ❌ | 400-600 | 中 | P3 |
| A13 | **OpenTelemetry GenAI 埋点** | `agents/gen_ai_telemetry.rs:52-108` | — | ❌ | 100-150 | 中（简历用） | P2 |
| A14 | **提示词模板化 + 用户覆盖** | `prompt_template.rs:9-46` | `templates/agent/*.md` | 半个（硬编码在 context.ts） | 150-250 | 中 | P2 |
| A15 | **MCP 接入** | `agents/mcp_client.rs`（50KB） | `agent/tools/mcp.py`（68KB） | ❌ | 1500+ | 低 | **不做** |
| A16 | **沙箱隔离** | `agents/container.rs` | `agent/tools/sandbox.py` | ❌ | 400+ | 低 | **不做** |
| A17 | **LLM-as-judge 权限** | `permission/permission_judge.rs` | — | ❌（**主动放弃，正确**） | 350 | 低 | **不做** |

---

## 三、Phase 1：把"半成品"补完（2 周）

> **为什么先做这 5 项**：它们都是**你已经开了头但没做完**的事。补完的成本远低于从零实现，而且每一项都能立刻在 eval 上量出效果。
> **这 5 项做完，你的 pass rate 和成本数据就会从"10-21 的旧数据"变成"10-24 之后的新数据"，而且是同一个题目集上可对比的数据。**

### 任务 1.1：修测试 + 重跑评测基线（1 天）

**为什么第一个做**：后面所有优化都要靠 eval 来验证效果。没有干净的基线，你改了代码也不知道是变好还是变坏 —— 这正是你自己在 PROJECT.md 里写过的那句"测量工具的 bug 比被测对象更可怕"。

**步骤**：

1. `vitest.config.mts` 加 `testTimeout: 30_000` + `hookTimeout: 30_000`
2. `npm test` → 确认 340/340 全绿
3. `npm run eval --dry` → 确认框架链路通
4. `npm run eval` → 真跑，记下：
   - pass rate
   - 总 token / 总成本
   - **每题 LLM 轮数**（这比 pass rate 更值得盯）
5. 更新 `eval/RESULTS.md`，提交，commit message 写：
   ```
   test(eval): 重跑基线（对应代码 commit <hash>）
   - pass rate: X%
   - token: Y（较 10-21 基线 ±Z%）
   ```

**验收标准**：测试全绿 + 有一份明确对应当前代码的评测基线。

**风险**：低。唯一的坑是 `.env` 里 `DEEPSEEK_API_KEY` 当前是空的，需要先填。

---

### 任务 1.2：双可见性 —— 让"用户看到的"和"模型看到的"分开（3 天）

**这是 goose 最值得抄的一个机制，而且你已经有字段了。**

**解决什么问题**（用比喻）：

> 想象你在跟一个只能看小抄的助手一起办案。
> 查案的卷宗有 300 页，助手的桌子只放得下 20 页。
>
> **现在的做法**：前 280 页直接销毁，桌上只剩 20 页 + 一张手写摘要。
> → 你想翻回去查"当时到底为什么这么判"？找不到，卷宗烧了。
>
> **goose 的做法**：卷宗一本没少（还按时间顺序摆在档案柜里，你能随时翻），只在助手的桌上放了一份**目录 + 摘要**。
> → 助手省了桌面空间，你也不丢证据。

**具体实现（3 处改动）**：

**改动 1** — `src/agent/loop.ts` 的 `maybeCompact()`，压缩时**不要原地重排**，改成打标记：

```ts
// 现在的写法（loop.ts:536-560）：直接重排 messages，用户看不到被压掉的历史
const newMessages: any[] = [];
if (systemIdx >= 0) newMessages.push(messages[0]);
newMessages.push({ role: 'system', content: `[摘要]...` });
newMessages.push(...protectedMessages);
newMessages.push(...recent);
messages.length = 0;
messages.push(...newMessages);

// 改成：保留全部消息，给"不再给模型看"的打上 agentVisible = false
for (const m of summarizable) {
  m.agentVisible = false;   // 模型看不到了，用户还看得到
}
// 摘要这条是"只给模型看"的
newMessages.push({
  role: 'system',
  content: `[摘要]...`,
  agentVisible: true,
  userVisible: false,   // 用户不用看这段技术摘要
});
```

**改动 2** — `src/session/store.ts` 的 `save()`：把 `userVisible` 也存进去（现在只存了 `agentVisible`）

**改动 3** — 关键：**发给模型前过滤**

```ts
// src/agent/loop.ts 顶部，调用 provider.stream 之前
const visibleToModel = messages.filter(m => m.agentVisible !== false);
for await (const chunk of this.provider.stream(visibleToModel, ...))
```

**改动 4** — Webview 侧：`src/webview/panel.ts:468` 的 `_messagesToWebview()` 改成**不过滤**（用户看全部），但要给被压缩的消息加个视觉标记（比如灰化 + "已压缩"角标）。

**为什么要做这个（三个理由，缺一不可）**：

1. **产品价值**：用户长对话后能回看完整历史 —— 这是真实用户会夸的功能
2. **技术价值**：这是 goose `context_mgmt/mod.rs:159-191` 的核心机制，能在面试里讲
3. **工程价值**：它让"压缩"变成**可逆**的 —— 调试时能看出压缩到底压掉了什么

**验收标准**：
- 造一个 50 轮的对话触发压缩
- 压缩后 Webview 里能看到全部 50 轮历史（压缩掉的灰显但可读）
- 发给模型的请求里只有摘要 + 保留的部分（用 provider 层打日志验证）
- **eval 的 18 道题全部重跑，token 应该下降（因为模型看到的更少了）**

---

### 任务 1.3：并行工具调用（2 天）

**比喻**：

> 你让助理去复印三份文件、并把三份分别装订。
> 现在是：复印 1 号 → 等 → 复印 2 号 → 等 → 复印 3 号 → 等。
> 改成：复印 1/2/3 号**同时**开始 → 等 → 三份一起装订。
>
> 前提是：这三件事**互不干扰**（你不能一边复印一边把原件撕了）。

**关键设计（nanobot 的 `_partition_tool_batches`，`tools/execution.py:294-318`）**：

不是无脑全并行，而是**按安全性分批**：

- 只读工具（read_file / grep / glob / list_dir）→ 全部并行
- 写工具（apply_patch / write_file）→ 串行，且必须逐个确认
- 同一文件的写操作 → 绝对串行（否则两个 patch 会互相覆盖）

**实现要点**：

```ts
// src/agent/loop.ts 的工具执行段，改成：
const batches = partitionBySafety(finalResponse.toolCalls);  // 读一批、写一批
for (const batch of batches) {
  if (batch.parallel) {
    // 并行执行，但结果必须按【原始顺序】拼回 messages
    const results = await Promise.all(
      batch.calls.map(tc => this.registry.execute(tc.name, parseArgs(tc), signal))
    );
    // ⚠️ 顺序必须保持一致！OpenAI 协议要求 tool 消息与 tool_call 一一对应
    results.forEach((r, i) => { /* push 到 messages */ });
  } else {
    for (const tc of batch.calls) { /* 串行，保持现有逻辑 */ }
  }
}
```

**⚠️ 三个必须注意的坑**：

1. **结果顺序必须和 tool_calls 顺序一致** —— 协议要求 `tool_call_id` 一一对应，顺序错了就是 400
2. **中断处理要更细** —— 并行执行时用户点"停止"，已经启动的 Promise 怎么办？（`signal` 传给每个工具，让它们自己 abort）
3. **审批弹窗不能并行** —— 写工具本来就要弹窗确认，绝对不能两个弹窗同时弹

**验收标准**：
- eval 18 道题重跑，**总耗时应该下降 15-30%**（这是最直观的指标）
- token 总量基本不变（并发不省 token，只省时间）—— 如果 token 大幅变化，说明有 bug
- 中断测试：并行执行中点停止，不产生孤儿 tool_call

---

### 任务 1.4：重复调用检测（3 天）

**这是你 eval 报告里暴露的最大问题，也是 nanobot 独有的能力（goose 都没有）。**

**你的 eval 报告原话**：

> ### 疑似死循环（单工具调用 ≥5 次）（7）
> - 13-hard-perf-optimize → 最多重复 10 次
>
> 最贵的 3 题：13-hard-perf-optimize ¥0.3575 / 120,439 token（20 轮）

**这 7 道题占了你总成本的绝大部分。**

**比喻**：

> 你让实习生去仓库拿三样东西。他跑了两趟，第一趟忘了拿扳手，第二趟忘了拿手套，第三趟忘了拿螺丝刀……
> **每次都付一趟路费**。
>
> 好的做法是：给他一张清单，拿完打勾。清单上有的，不用再跑。
>
> 更微妙的：清单上的东西**已经被人动过了**，那就得重新去核实一次 —— 但要告诉他"上次你拿过，但现在位置可能变了"。

**nanobot 的两层设计（这是精华，要照抄）**：

**第一层：文件读取去重**（`nanobot/agent/tools/file_state.py:80-97`）

记录每次读取的：`path` / `offset` / `limit` / **文件内容 hash** / **结果 hash** / `tool_call_id`

再次读同一文件时，**四重校验**：
1. 参数完全一致
2. 磁盘上的文件内容 hash 未变
3. **原结果仍然存在于当前模型的上下文里** ← 这条是精髓
4. 才返回 `"[File unchanged since last read: {path}]"` 而不是完整内容

**为什么第 3 条是精髓**：因为上下文压缩会把旧结果移出上下文。此时如果还返回 stub，模型就永远看不到那个文件的内容了 —— 信息丢失。**所以必须检查"模型现在还看不看得见"**。

**第二层：重复外部查询节流**（`nanobot/utils/runtime.py:93-131`）

对 `web_fetch`（按 URL）/ `web_search`（按 query）生成签名，第 3 次直接拦截：
> "Use the results you already have to answer, or try a meaningfully different source"

**实现建议（你的项目里）**：

新建 `src/agent/tools/repeatGuard.ts`：

```ts
interface ReadReceipt {
  path: string;
  offset?: number;
  limit?: number;
  contentHash: string;   // 磁盘内容的 hash
  resultHash: string;    // 工具结果内容的 hash
  callId: string;        // 存在 messages 里的位置
}

export class RepeatGuard {
  private reads = new Map<string, ReadReceipt>();
  private queries = new Map<string, number>();

  // 检查"这个文件是否已经读过且内容没变"
  checkRead(path, offset, limit, currentContentHash, isStillVisible): string | null {
    // 返回 null = 正常执行；返回字符串 = 应该返回给模型的提示
  }

  // 检查"这个外部查询是否重复过多"
  checkQuery(signature): string | null { }
}
```

**接入点**：`src/agent/tools/readFile.ts` 的 `execute()` 开头调用 `checkRead`；`grep.ts` 同理。

**⚠️ 一个必须做的设计决策**：

拦截时**不能硬拒绝**（返回 error），要返回**信息性提示**：

```
✅ 正确：[File unchanged since last read: src/parser.js]
   （模型看到这句，知道自己已经读过，直接用之前的结果）

❌ 错误：[错误] 该文件已读取过
   （模型会以为工具坏了，然后换个方式再读一遍 —— 更糟）
```

**验收标准**：
- eval 18 道题重跑
- **总 token 下降 ≥ 20%**（这是核心指标）
- **LLM 轮数下降 ≥ 15%**
- **pass rate 不下降**（如果降了，说明拦截太激进，把"故意重读确认"也拦了 —— 那要放宽条件）
- 新增对抗题：故意让 agent 反复读同一个文件，看它是否会被正确引导

---

### 任务 1.5：Prompt 快照测试（2 天）

**这是 goose 测试方法论里最值得抄的一个，代码量极小，收益极大。**

**goose 的做法**（`crates/goose/src/agents/prompt_manager.rs:424/440/461/525`）：

用 `insta` 库对**完整系统提示词**做快照断言。任何人改了 prompt，diff 一眼可见。

**为什么这个对 agent 项目特别重要**：

> 改 prompt 是 agent 开发里最常见的操作，也是**最容易悄悄搞坏东西的操作**。
>
> 你改了 system prompt 里的某句话 → 某道题的 pass rate 从 ✅ 变 ❌ → 但你不知道是哪句话的锅，
> 因为你同时也改了别的东西。
>
> **快照测试把 prompt 变成"代码"**：改了就必须承认改了。

**实现**（vitest 原生支持，不用装依赖）：

```ts
// src/__tests__/promptSnapshot.test.ts
import { describe, it, expect } from 'vitest';
import { ContextBuilder } from '../agent/context';

describe('system prompt 快照', () => {
  it('基础 prompt 不应随意变化', () => {
    const prompt = new ContextBuilder('/fake/workspace').buildSystemPrompt();
    expect(prompt).toMatchSnapshot();
  });

  it('有 skills 时 prompt 的变化', () => {
    // ...
  });
});
```

**配套做 3 个断言（比裸快照更有价值）**：

```ts
it('prompt 里必须包含工具限制说明', () => {
  const p = new ContextBuilder('/fake').buildSystemPrompt();
  expect(p).toContain('工具限制');
});

it('prompt 里绝不能出现 API Key', () => {
  const p = new ContextBuilder('/fake').buildSystemPrompt();
  expect(p).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);   // 防泄密
});

it('prompt 长度必须在预算内', () => {
  const p = new ContextBuilder('/fake').buildSystemPrompt();
  expect(p.length).toBeLessThan(20_000);   // 超了就是有东西没被外置
});
```

**验收标准**：
- 快照文件提交进 git
- 以后每次改 prompt，`git diff` 能立刻看到提示词变了多少

---

## 四、Phase 2：从"能跑"到"能扛"（4 周）

> Phase 1 解决的是"能不能测量"。Phase 2 解决的是"真实用户用的时候会不会崩、会不会烧钱"。

### 任务 2.1：Provider 熔断降级（1 周）

**为什么这是 BYOK 产品的生死线**：

你的用户是"自带 Key"的开发者。他们会遇到：
- Key 过期了 → 401
- 账户欠费了 → 402
- MiniMax 国内站抽风 → 500
- 限流 → 429

**现在的行为**：直接报错，agent 罢工，用户骂人。

**nanobot 的设计**（`providers/fallback_provider.py`）：

**第一步：错误分类**（`:716-759`）—— 不是所有错误都该重试：

| 错误 | 该降级吗 | 理由 |
|---|---|---|
| 欠费（402） | ✅ 降级 | 换家还能用 |
| 鉴权失败（401/403） | ✅ 降级 | 换家还能用 |
| 429 / 5xx / 408 | ✅ 降级 | 临时故障 |
| 400 / 404 / 422 | ❌ 不降级 | 请求本身有问题，换谁都一样 |
| 用户主动 abort | ❌ 不降级 | 用户不想等了 |

**第二步：熔断器**（`:521-527`）—— 连续 3 次可降级错误 → 熔断 60 秒 → 期间直接跳过这个 provider

**第三步：流式安全**（`:494-511`）—— 如果主模型已经吐了一半内容才失败，**只有 timeout 才敢降级**（并且要重开流段），其他错误直接返回。否则用户会看到两个模型的输出拼在一起。

**实现**：

```ts
// src/agent/providerFallback.ts
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private readonly threshold = 3;
  private readonly cooldownMs = 60_000;

  recordSuccess() { this.failures = 0; }
  recordFailure() { this.failures++; }
  isOpen(): boolean { return this.failures >= this.threshold && Date.now() - this.openedAt < this.cooldownMs; }
}

export function shouldFallback(err: ProviderError): boolean {
  if (err.name === 'AbortError') return false;
  if (err.status && [400, 404, 422].includes(err.status)) return false;
  return true;
}
```

**注意你的 `errors.ts` 已经有细分错误类了**（`AuthError` / `RateLimitError` / `CreditsExhaustedError` / `EndpointNotFoundError`）—— 这意味着 `shouldFallback` 几乎可以直接写出来，**这是个顺水推舟的活**。

**验收标准**：
- 模拟 401 → 自动降级到下一个 provider，用户无感
- 模拟 400 → 不降级，直接报错（避免"换家再错一次"浪费时间）
- 连续 3 次失败 → 熔断，UI 上明确提示"该 provider 已熔断，60 秒后重试"

---

### 任务 2.2：Hook 机制（1.5 周）

**这是 goose 最有产品价值的一个机制，而且直接服务于你的"特色 1：自动跑测试"。**

**现在的问题**：

`src/features/autoTest.ts` 把"自动跑测试"硬编码成：`FileSystemWatcher` → 防抖 → 找相关测试 → 跑 → 提示 AI 修。

这条链路是**写死的**。你想加"改完代码自动跑 lint"、"提交前自动检查"、"读文件前自动脱敏"，都得改 `autoTest.ts`。

**goose 的做法**（`crates/goose/src/hooks/mod.rs`）：

12 个生命周期点（`:55-68`）：
```
PreToolUse / PreToolUseResult / PostToolUse / PostToolUseFailure
SessionStart / SessionEnd / UserPromptSubmit
BeforeReadFile / AfterFileEdit
BeforeShellExecution / AfterShellExecution
Stop
```

声明式配置（`:1-24`）：
```jsonc
{
  "hooks": {
    "Stop": [{
      "matcher": ".*",
      "hooks": [{ "type": "command", "command": "npm test" }]
    }]
  }
}
```

**只有两个点能"阻断"**：
- `PreToolUse` → 否决工具调用（`ops_toolcalling.rs:119-160`）
- `Stop` → 拒绝结束回合，注入一条消息让模型继续干（`ops_stop_hook.rs:80-119`）

**防死循环**：`Stop` hook 连续 block 超过 8 次就强制放行（`agent.rs:58`）。

**对你的意义**：

> **把"自动跑测试"从"一个功能"升级成"一个平台能力"。**
>
> 面试时你可以说：
> "我把自动测试重构成了一套 12 点生命周期 hook 机制，用户可以写 hooks.json 定制自己的工作流，
>  内置的自动测试只是这套机制的第一个消费者。"
>
> 这句话的分量，比"我实现了一个自动跑测试的功能"高一个量级 —— 因为前者说明你懂**抽象与复用**，后者只说明你写了个功能。

**实现（务实版，2 周）**：

不要一次做 12 个点。先做 **4 个最有用的**：

| Hook | 时机 | 用途 |
|---|---|---|
| `PreToolUse` | 工具调用前 | 可否决（现有的 approval 逻辑可以挂这里） |
| `PostToolUse` | 工具调用后 | 通知（autoTest 可以挂这里） |
| `Stop` | 回合结束前 | **测试没过就不许结束**（最强的差异化点） |
| `UserPromptSubmit` | 用户发消息后 | 注入上下文（如当前 git 分支、待办） |

**关键设计：`Stop` hook 的语义是"agent 说'我做完了'，但 hook 说'不许结束'"**

```
Stop hook 跑 `npm test` → 退出码非 0 → 
  → 注入一条消息给模型："测试没通过，输出如下：xxx，请修复后重试"
  → 模型继续干活
  → 连续 8 次都失败 → 强制放行并告知用户
```

**这正好解决了你 eval 里 L3 对抗档 23 题（fake-green-test）的真实痛点**：agent 声称改好了但测试其实没过。

**验收标准**：
- 用户写一个 `hooks.json` 让 Stop 时跑 `npm test`
- agent 改坏代码后试图收工 → 被 hook 打回 → 自动修复
- hook 命令报错（脚本不存在）→ 不阻断主流程，只记日志

---

### 任务 2.3：Todo / 计划模式（1 周）

**goose**：`platform_extensions/todo.rs:17-120`，一个 `todo_write` 工具，状态存 session（`session/extension_data.rs:85-99`），**压缩后仍在**。

**Claude Code 的 TodoWrite** 是结构化数组：
```json
[{ "content": "实现 parser", "status": "in_progress", "activeForm": "正在实现 parser" }]
```

**建议直接做 Claude Code 那种结构化版本**，不要抄 goose 的极简字符串版。

**为什么对 agent 岗重要**：Todo/Plan 是 Claude Code 最被面试官问到的机制之一，因为它体现了"**agent 怎么管理多步任务的中间状态**"。

**关键工程点**：Todo 状态必须**存在 session 里**（不能只在内存），否则上下文压缩后 todo 丢了，模型就不知道自己在第几步。

**验收标准**：
- 用户说"帮我重构这个模块，分三步" → agent 自动生成 todo
- 每完成一步自动更新状态
- 上下文压缩后 todo 还在（这是关键验收点）

---

### 任务 2.4：上下文预算升级（1 周）

**现状**：`loop.ts:110` 用 `COMPACT_THRESHOLD_RATIO = 0.7`（上下文窗口的 70%），`util/tokens.ts` 做本地估算。

**问题**：
1. **本地估算不准** —— 中文和英文的 token/字符比差 3 倍（你自己在 `loop.ts:405-411` 写过这个）
2. **没考虑输出预留** —— 上下文窗口 = 输入 + 输出，你按 70% 触发压缩，但输出可能也要占 20%
3. **provider 返回了真实 usage 却不用**

**nanobot 的三级测量**（`context_governance.py:414-447`）：
1. provider 返回的真实 `usage`（最准）
2. provider 可续传 state + pending messages 的估算
3. 本地估算兜底

**预算公式**（`providers/base.py:41`）：
```
budget = context_window − max_output_tokens − 1024(buffer)
```

**你的实现路径**：`src/util/tokens.ts` 已经估算中英文了，改成：
```ts
const budget = this.contextWindow - maxOutputTokens - 1024;
const used = providerReportedUsage ?? estimateMessagesTokens(messages);
if (used > budget * 0.7) { /* 触发压缩 */ }
```

**验收标准**：
- 长对话不出现 400（context length exceeded）
- 压缩触发时机比现在更准（用真实 usage 而不是估算）

---

## 五、Phase 3：加分项（按性价比排序，2-3 周）

> 这些**不是必须做的**。但每做完一项，简历上就多一个能讲 10 分钟的技术点。

### 任务 3.1：OpenTelemetry GenAI 埋点（3 天）⭐ 推荐

**为什么这个性价比最高**：goose 用了 `crates/goose/src/otel/` + `agents/gen_ai_telemetry.rs` + `tracing/langfuse_layer.rs` + `tracing/observation_layer.rs`，一共 4 个文件。你的项目有**自研 logger**（`src/logger.ts`）—— 只要把埋点接上去就行。

**GenAI 语义约定字段名**（`gen_ai_telemetry.rs:52-108`）：
```
gen_ai.system          → "openai" / "deepseek"
gen_ai.request.model   → 模型名
gen_ai.usage.input_tokens / output_tokens
gen_ai.tool.call.id / gen_ai.tool.name
gen_ai.usage.cost
```

**对你的独特价值**：

> 你已经有**真实的成本数据**（eval 报告里有 token 和 ¥）。
> 加上 OTel 埋点后，你就有了"**每次真实用户会话的成本**"的数据 —— 这是运营一个 agent 产品的真实能力。
>
> 简历写法："接入了 OpenTelemetry GenAI 语义约定，实现单次会话的 token/成本/工具调用链追踪，支撑成本归因与异常定位。"

**验收标准**：
- 每次 LLM 调用产生一条 span，含模型名、token 数、成本
- 每次工具调用产生子 span
- 能在日志里看到完整的调用树

---

### 任务 3.2：用户中途插话（Steering）（3 天）

**goose**：`ops_steer.rs:60-97` —— 只在**两轮之间**且**没有待答工具请求**时生效。

**场景**：
> agent 正在改 5 个文件，用户突然说"等等，第 3 个文件先别动" —— 现在只能点停止，然后重新开始。
>
> 有 steering 的话，用户消息会**排队**，在当前工具批次完成后注入。

**实现要点**：
- Webview 侧：停止按钮旁边加"插入消息"
- loop 侧：每轮开始时检查队列
- 注入位置：**作为 user 消息插在下一轮开头**，不要打断正在执行的工具

---

### 任务 3.3：子智能体（1.5 周）

**先说结论**：这个**值得做**，因为它是简历上最硬的多智能体关键词；但要**做最小版**。

**goose 的设计**（`platform_extensions/summon.rs:45-57`）：子智能体就是一个**普通工具** `delegate`，LLM 决定什么时候调用。

```
主 agent: "这个项目有 3 个模块都要改，你去分别调查一下"
  → 调用 delegate(task="调查模块A的调用链", maxTurns=10)
  → 子 agent 独立 session、独立 system prompt、独立 maxTurns
  → 返回最终输出字符串
  → 主 agent 的上下文里只多了这段字符串（不是几万 token 的中间过程）
```

**关键收益（用比喻）**：

> 让实习生去查三个部门的档案，但**主 agent 的桌子只放得下一份报告**。
>
> **串行**：主 agent 自己去查 A（桌上堆了 A 的全部资料）→ 查 B（A 的资料还堆着）→ 查 C → 桌子满了。
> **并行 + 子 agent**：三个实习生各查各的，各回一份**摘要报告**。主 agent 桌上只有 3 份报告。
>
> 这就是子智能体的全部价值：**隔离上下文**。

**最小版实现（不要做 nanobot 那套 create/send/cancel/check 四动作）**：

```ts
// src/agent/tools/delegate.ts
export class DelegateTool implements Tool {
  readonly name = 'delegate';
  readonly meta = execMeta(false);

  async execute(args: { task: string; maxTurns?: number }) {
    // 1. 建独立 messages（独立上下文）
    const subMessages = [{ role: 'user', content: args.task }];
    // 2. 用同一套 AgentLoop 跑（这是你架构的一个红利 —— loop 与 vscode 解耦）
    const subLoop = new AgentLoop(this.provider, this.registry, args.maxTurns ?? 10, this.model);
    const answer = await subLoop.run(subMessages, this.signal, {});
    // 3. 只返回最终答案，中间过程不进入父上下文
    return { content: answer };
  }
}
```

**⚠️ 关键约束**：
- 子 agent **绝对不能**拿到写权限（只给只读工具）—— 否则它可能在你不知情的时候改文件
- 子 agent 的结果必须**如实报告**，包括"我没找到"
- 父 agent 只拿最终字符串，但**父的上下文里要保留子 agent 用了哪些工具的摘要**（否则父不知道子干了什么）

**验收标准**：
- 用户："调查一下项目里所有用了 X 的地方" → agent 调 delegate → 子 agent 独立搜索 → 主 agent 拿到总结
- 主 agent 的上下文 token 增量很小（< 500 token），而不是几万

---

## 六、明确不做的（以及为什么）

这一节很重要，因为**方向错误比努力更贵**。

| 项 | goose 行数 | nanobot 行数 | 不做的理由 |
|---|---|---|---|
| **MCP 接入** | 200KB+ | 68KB | VS Code 用户已有自己的 MCP 生态（Copilot 等），你再做一套是重复建设。**但可以抄一个东西**：goose `agents/extension.rs:91-128` 的**31 个危险环境变量黑名单**（防 `PATH`/`LD_PRELOAD`/`NODE_OPTIONS` 劫持）—— 20 行，性价比极高，**建议做** |
| **沙箱隔离** | 容器 | 400+ | 你的插件跑在用户自己的机器、用户自己的 shell 里，信任边界和 nanobot（跑在服务器上）完全不同 |
| **LLM-as-judge 权限** | 350 | — | **你已经正确地拒绝了**，理由写在 `approval.ts:24-32`，这是对的，别改回去 |
| **30 个聊天 Channel** | — | 大量 | 跟 VS Code 插件零交集 |
| **Gateway / WebUI / 多租户** | — | 大量 | 服务端产物 |
| **完整 Provider 矩阵**（Bedrock/Codex OAuth/xAI…） | 500KB+ | 700KB+ | BYOK 产品的用户就是自己挑 provider 的开发者，4 个主流的够用 |
| **Op 化状态机** | 700 | — | 优雅但你的项目还没大到需要。等 Phase 1-3 做完、代码超过 2 万行再考虑 |
| **Dream 记忆整合** | — | 300 | nanobot 用 git 追踪记忆文件变更，机制漂亮但权重太重。**只抄"分层文件 + 标记体系"，不抄 git** |

---

## 七、时间线与里程碑

> 假设每周投入 **15-20 小时**（在校生 + 兼顾课业）。
> 如果你全职投入（30h+/周），可以压缩到 8 周。

| 阶段 | 周次 | 内容 | 里程碑验收 |
|---|---|---|---|
| **P0 修地基** | W1 前半 | 修 testTimeout、重跑基线、提交新基线 | 340/340 绿 + 新基线提交 |
| **P1 补半成品** | W1 后半 - W2 | 双可见性、并行工具、重复调用检测、Prompt 快照 | **token ↓20%、轮数 ↓15%、pass rate 不降** |
| **P1 验收** | W3 | eval 全量重跑 + 对比报告 + README 更新 | 一张"优化前后对比表"进 README |
| **P2 抗压** | W3 - W6 | Provider 降级、Hook 机制、Todo 模式、上下文预算 | Hook 能拦住"测试没过却收工"的 agent |
| **P2 验收** | W6 | eval 重跑 + 新增 Hook 相关对抗题 | 评测集新增 ≥ 4 题 |
| **P3 加分** | W7 - W9 | OTel 埋点、Steering、子智能体 | 至少完成前两项 |
| **P3 验收** | W9 | eval 重跑 + 架构文档 | 一份 `ARCHITECTURE.md` |
| **收尾** | W10 | 发布 Marketplace + 写技术博客 + 简历素材整理 | 简历可写 |

### 每个阶段的"必须有的产出物"

| 阶段 | 产出物 | 为什么 |
|---|---|---|
| P0 | 新基线评测报告 | 所有后续对比的锚点 |
| P1 | **优化前后对比表**（token/轮数/pass rate/耗时） | **这是简历上最有说服力的一张图** |
| P2 | 架构文档 + hook 使用文档 | 证明工程化，不是玩具 |
| P3 | 技术博客 1 篇 | 投递简历时的"附加材料" |

---

## 八、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| **Phase 1 改动引入回归** | 中 | 高 | 每改一项就重跑 eval 的一个子集（`npm run eval -- 13 15`），别攒到最后一起跑 |
| **并行化引入 tool_call 顺序错乱** | 中 | 高（直接 400） | 必须在 messages.push 时严格按原始 tool_calls 顺序；写一个专门的单测覆盖 |
| **重复调用检测拦太狠** | 中 | 中（pass rate 降） | 严格按 nanobot 的"四重校验"，特别是"结果是否仍在上下文里"这条；pass rate 降了就放宽 |
| **Hook 机制做成大工程** | 高 | 中 | **只做 4 个 hook 点**，别做 12 个。宁可少做，不可半途 |
| **子智能体失控** | 低 | 高（改坏文件） | 子 agent 只给只读工具；父 agent 负责最终写操作 |
| **评测集饱和**（改什么都不涨） | 高 | 高（失去反馈信号） | 每次优化前先确认"有区分度"：把 pass rate 和 token/轮数**两个维度**一起看。如果 pass rate 满但 token 在降，说明还有信号；如果两个都不动，说明题太简单了，该加题 |
| **课业冲突导致断更** | 高 | 中 | 每个任务都拆成"当天能做完"的粒度；提交粒度比任务粒度更重要 |
| **API 成本超支** | 低 | 低 | 一轮全量 eval ≈ ¥2.5，日常只跑子集 |

---

## 九、简历怎么写（基于实际做完的东西）

> ⚠️ **不要现在就写这些** —— 等 Phase 1/2 做完再写。每一条都要有可验证的数据支撑。

**项目名称**：`Mini-Coder — 带回归检测的自评测 AI 编程助手（VS Code 插件）`

**推荐结构**（STAR 变体：Situation → Task → Action → Result）：

```
【一句话】
面向中文开发者的 VS Code AI 编程助手。核心不是"能对话"，而是
"能证明自己是对的"——内置带回归检测的评测体系，把 AI 编程助手最典型的
失败模式（改对目标、弄坏别处）变成可测量、可回归的工程指标。

【技术栈】
TypeScript / VS Code Extension API / React+Vite Webview / OpenAI 兼容协议
(BYOK) / Vitest / 自研 ReAct Agent 循环

【关键工程设计】（每条配数据）
1. 评测基线：18 道三档难度任务，每题 baseline→after 三方比对，
   识别"agent 把对的改坏了"的回归失败（业界同类项目普遍缺失此维度）
2. 协议层自愈：修复 OpenAI 兼容协议下孤儿 tool_call 导致的永久 400 故障，
   采用"显式告知未执行"而非"静默删除"，避免模型重复产生副作用
3. 上下文治理：双可见性架构（用户可见 / 模型可见解耦）+ 渐进式技能加载 +
   大输出外置，工具调用轮数下降 XX%，输入 token 下降 XX%
4. 回归防护：写入前 checkpoint 快照 + 审批 diff 预览 + 一键回滚，
   构成"事前知情 - 事中留痕 - 事后可撤"的完整闭环
5. 自研 Provider 层：SSE 流式解析、错误分类（鉴权/限流/欠费/模型不存在）、
   熔断降级，全部基于 fetch 实现不依赖 SDK

【数据】
评测集 18 题，pass rate XX%（含 XX% 对抗档题目），单次会话平均 token XXX，
成本较优化前下降 XX%
```

**面试时必答的三个问题**（提前准备）：

1. **"你怎么知道你的 agent 是对的？"**
   → 讲 baseline→after 三方比对 + 回归检测 + 标准答案校验器
   → 讲"测量工具的 bug 比被测对象更可怕"那个真实教训（`PROJECT.md` 里有）

2. **"你的项目跟 Cline / Continue / Copilot 有什么区别？"**
   → **不要贬低对手**。说："它们是产品，我的是工程实践的载体。
   → 我的差异化在**可测量性**：我能给出每一道题的 token 成本、工具调用轮数、
   → 回归失败数。Cline 有 pass/fail，但没有"这个失败是我的 agent 造成的还是
   → 题目本来就难"这个区分。"

3. **"如果让你重做，你会怎么设计？"**
   → 讲 goose 的 op 化状态机 + Effect 落盘（说明你研究过工业级实现）
   → 讲 nanobot 的内核/编排/治理三层分离
   → 讲"如果代码量到 2 万行，我会把 ReAct 循环重构成 op 管线"

---

## 十、立刻可以做的 5 件事（今天/本周）

按顺序做，每件都有独立产出：

- [ ] **① 修 `vitest.config.mts` 的 timeout** → `npm test` 变 340/340 绿（5 分钟）
- [ ] **② 填好 `.env` 的 `DEEPSEEK_API_KEY`** → 能跑 eval（2 分钟）
- [ ] **③ `npm run eval` 重跑基线** → 拿到对应当前代码的真实数据（约 6 分钟 + ¥2.5）
- [ ] **④ 提交基线**，commit message 写明对应代码 commit（5 分钟）
- [ ] **⑤ 读 `src/agent/loop.ts` 的 `maybeCompact()`，标出 3 处要改的位置**（用注释标出来就行，先不改）（30 分钟）

> 完成这 5 件事，你就有了**干净的基线**和**明确的改造靶子**。
> 后面每一个改动，都能用 `npm run eval -- <题号>` 快速验证效果。

---

## 附录 A：关键文件索引

**你要改的文件**：

| 文件 | 行数 | 要做什么 |
|---|---|---|
| `vitest.config.mts` | 33 | 加 `testTimeout` |
| `src/agent/loop.ts` | 567 | 双可见性、并行工具、上下文预算 |
| `src/agent/toolOutputStore.ts` | 13KB | 已完成，不动 |
| `src/session/store.ts` | 366 | 加 `userVisible` 存储 |
| `src/webview/panel.ts` | 520 | `_messagesToWebview()` 支持灰显压缩消息 |
| `src/agent/tools/readFile.ts` | 3.4KB | 接入重复调用检测 |
| `src/agent/tools/grep.ts` | 7.7KB | 接入重复调用检测 |
| `src/agent/context.ts` | 219 | 提示词模板化（Phase 3） |
| `src/logger.ts` | 2.2KB | OTel 埋点接入点 |
| `src/eval/runner.ts` | 345 | 评测加"每题轮数"维度（已有） |

**你要新增的文件**：

| 文件 | 预估行数 | 干什么 |
|---|---|---|
| `src/agent/tools/repeatGuard.ts` | 120 | 重复调用检测 |
| `src/agent/providerFallback.ts` | 200 | 熔断降级 |
| `src/agent/hooks/` | 300 | Hook 机制（4 个点） |
| `src/agent/tools/delegate.ts` | 150 | 子智能体 |
| `src/__tests__/promptSnapshot.test.ts` | 80 | Prompt 快照 |

**参考项目里要读的**：

| 项目 | 文件 | 看什么 |
|---|---|---|
| goose | `crates/goose/src/context_mgmt/mod.rs:89-226` | 双可见性的完整实现 |
| goose | `crates/goose/src/hooks/mod.rs:55-208` | Hook 机制 |
| goose | `crates/goose/src/agents/state_machine/ops_steer.rs:60-97` | 插话 |
| goose | `crates/goose/src/agents/platform_extensions/summon.rs:45-57` | 子智能体 |
| goose | `crates/goose/src/agents/gen_ai_telemetry.rs:52-108` | OTel 字段名 |
| goose | `crates/goose/src/agents/state_machine/tests/dummy_api.rs` | 脚本化假 Provider |
| goose | `crates/goose/src/agents/extension.rs:91-128` | 危险环境变量黑名单 |
| nanobot | `nanobot/agent/tools/file_state.py:80-97` | 重复读取去重（四重校验） |
| nanobot | `nanobot/utils/runtime.py:93-131` | 重复查询节流 |
| nanobot | `nanobot/agent/tools/execution.py:82-108, 294-318` | 并行分批 |
| nanobot | `nanobot/providers/fallback_provider.py:461-560` | 熔断降级 |
| nanobot | `nanobot/templates/agent/_snippets/untrusted_content.md` | 提示注入防护（2 行，强烈建议抄） |
| nanobot | `nanobot/agent/context_governance.py:414-447` | 三级 token 测量 |

---

## 附录 B：一句话总结

> **别去追 goose 和 nanobot 的功能数量，追它们的"可测量性"。**
>
> 你的项目已经有了三个项目里最独特的资产 —— 带回归检测的评测基线。
> 现在要做的是：**把这套测量能力从"评测题目"扩展到"产品的每一条代码路径"**。
>
> 做完之后，你的简历上会有一句话，是 95% 的候选人写不出来的：
>
> **"我给 AI Agent 建了一套带回归检测的评测基线，并用它把单次任务的
> token 成本降低了 XX%、把工具调用轮数降低了 XX%，同时证明这些优化
> 没有引入新的回归。"**
