# AGENTS.md —— 给 AI 协作者的说明书

> **这个文件有两类读者：**
> ① 别的 AI 工具（Claude Code / Cline / Cursor / Goose）
> ② 第一次接触这个仓库的人类开发者
>
> 两者要的是同一份东西：**这个仓库的规矩**。
>
> ---
>
> **⚠️ 一个你可能不知道的事实：Mini-Coder 会自动加载这个文件。**
>
> `src/agent/context.ts:34` 的 `BOOTSTRAP_FILES = ['AGENTS.md', 'SOUL.md', 'USER.md']`
> 会在每次启动时把工作区根目录的这些文件读进 system prompt。
> 所以你在这里写的每一条规则，**Mini-Coder 自己的 agent 也会遵守**。
>
> 换句话说：**你不是在写文档，你是在给这个 agent 立规矩。**
> 写完记得自己验证一遍效果。

---

## 项目一句话

**VS Code AI 编程助手。** 一个自研的 ReAct Agent 运行时 + 一套能证明"改好了而且没弄坏别处"的回归检测评测体系。
TypeScript，**零运行时依赖**（只用 Node 内置模块 + `fetch`）。

| 规模 | 实测值（2026-10-27） |
|---|---|
| 源码 | `src/` 非测试 **84 个文件 / 17,548 行** |
| 测试 | **37 个文件 / 7,574 行 / 529 个用例** |
| 工具 | **11 个**（4 只读 + 3 状态 + 3 写 + 1 执行） |
| Agent 管线 | **9 个 Operation**（`src/agent/operations/`） |
| 评测集 | **30 题**（5 简单 / 16 困难 / 9 对抗）+ 30 份标准答案 |

> 行数口径：按 `ReadAllText -split "\n"` 统计（物理行，含空行）。
> 用 `Measure-Object -Line` 会低估 17%（它不计空行）。

---

## 🚨 硬性规矩（违反了是 bug，不是风格问题）

### Rule 1：Agent 运行时层不许 import `vscode`

**为什么**：同一份 `AgentLoop` 要能同时跑在三个地方——
VS Code 扩展宿主、离线评测沙箱、单元测试。
一旦 `src/agent/**` 依赖了 `vscode` API，评测就跑不起来，测试就得靠 mock 撑着。

**范围**：`src/agent/**`、`src/eval/**`、`src/util/**`

**怎么验证**：
- `src/__tests__/stubs/vscode-stub.ts` 只在**界面层**测试里用
- 纯运行时测试（`agentLoop.test.ts` / `operations.test.ts`）**不 import vscode 也能跑**
- 新增运行时模块时，问自己一句："如果现在把它拷到评测沙箱里，能跑吗？"

---

### Rule 2：新增工具必须显式声明 `meta`，且用对 `kind`

**为什么**：权限档位、并发策略、checkpoint 全部靠 `meta` 静态映射。
声明错了 = 越权。

```typescript
// ✅ 对的写法
readonly meta = readOnlyMeta();   // 只读：自动放行 + 允许并行
readonly meta = writeMeta();      // 改文件：要确认 + 存快照
readonly meta = execMeta();       // 跑命令：要确认，副作用在 agent 之外
```

**⚠️ `kind` 不是冗余字段**：
`write_file` 和 `run_shell` 的 `readOnly` 都是 false、`destructive` 都是 true，
但它们**必须是两件事**——改文件改了能撤回（checkpoint），
跑命令可能 `rm -rf`、可能推远端，**撤不回来**。

**怎么验证**：`npm run check` 会检查 `ALL_TOOL_NAMES` 和注册表一致。

---

### Rule 3：工具的 `execute()` 只管取数据，**不要在里面加安全声明**

**为什么**：信任边界（`<untrusted_content>` 标记）打在**管线出口**，
也就是 `src/agent/operations/toolExecution.ts` 把结果 push 进 messages 的那一个点。

> **第一版的教训**：最初在 `read_file` / `grep` 里各自包了一层。
> 结果 `run_shell` 没包——而恶意内容完全可以从 `cat README.md` 的**命令输出**进来。
> 挪到管线出口之后，**所有**工具输出都被标记，包括以后新加的。
> 这才是"默认安全"（fail-safe）而不是"默认不安全"。

**怎么验证**：新工具里如果出现 `<untrusted_content>` 字样，就是写错了。

---

### Rule 4：`src/agent/` 下不许用模块级可变状态存跨轮数据

**为什么**：评测时**多题并发**，模块级变量会串味。
A 题的待办漏进 B 题，评测结果就废了，而且**极难排查**。

**怎么做**：跨步骤共享的状态放 `ctx.state`（`OperationContext` 的字段）。

**例外**（这些是有意为之的模块级单例）：
- `src/agent/visibility.ts` / `observability/spans.ts` —— 纯展示层
- `src/agent/steering.ts` —— 队列**和面板共享同一个数组引用**，
  靠引用共享而不是靠复制，是刻意的设计
- `src/agent/tools/delegate.ts` 的 `runtime` —— 由 `loop.ts` 在构造时注入

---

### Rule 5：改了 agent 行为，必须重跑 `npm run eval` 并提交 `eval/results.json`

**为什么**：这个项目卖的是"**可验证**"。
没有评测数据 = 没有证据 = 简历上那句话没人信。

**怎么做**：
```powershell
npm run eval        # 全量 30 题，约 ¥3.9
git add eval/results.json eval/RESULTS.md
```

> **把 `results.json` 提交进 git 是有意的**：
> 这样 `git log -p eval/results.json` 就是一条**能力曲线**，
> 面试官可以自己翻看你每一次优化的效果。
> 这是 goose 和 nanobot 都没有的东西（nanobot 根本没有评测框架）。

---

### Rule 6：不要在 `provider.ts` 里写和"模型无关"的逻辑

**为什么**：加一个 provider 应该是**改一张表**，不是改逻辑。
`PROVIDER_CONFIGS` 是 provider 的唯一真相源。

**⚠️ 已犯过的错**：`package.json` 的 provider 枚举里列过 `anthropic`，
但代码里根本没实现——**用户选了会被静默丢弃并回落到 DeepSeek**。
这就是"配置项骗用户"。
所以：**改枚举时必须同步改 `PROVIDER_CONFIGS`**，反之亦然。

**怎么验证**：`npm run check` 的 `[provider-enum]` 检查项。

---

### Rule 7：任何"魔法数字"都要有单一真相源

**为什么**：同一个值散落在多个文件里，改一处忘另一处 = bug。

**现有的真相源**：

| 信息 | 唯一出处 |
|---|---|
| 工具名单 | `src/agent/tools/factory.ts` 的 `ALL_TOOL_NAMES` |
| Operation 名单 | `src/agent/operations/index.ts` 的 `ALL_OPERATION_NAMES` |
| 只读工具名单 | `src/agent/tools/meta.ts` 的 `ReadOnlyToolNames` |
| 迭代上限 | `src/agent/limits.ts` 的 `MAX_ITERATIONS` |
| Provider 配置 | `src/agent/provider.ts` 的 `PROVIDER_CONFIGS` |
| 上下文窗口 | `src/util/tokens.ts` 的 `MODEL_CONTEXT_WINDOWS` |

**怎么验证**：`npm run check` 的 `[no-drift]` 检查项（迭代上限单一真相源）。

---

## 🗺️ 架构速览

```
界面层（碰 vscode API）          运行时层（纯逻辑）            横切层
─────────────────────         ────────────────────         ──────────
webview/panel.ts               agent/loop.ts                 agent/trust.ts
commands/*.ts                  agent/operations/ (9 个)      agent/visibility.ts
features/*.ts                  agent/tools/ (11 个)          agent/tools/repeatGuard.ts
                               agent/provider.ts             agent/tools/approval.ts
                               agent/context.ts              agent/checkpoint/
                               session/                      agent/hooks/
                               skills/
```

**依赖方向单向**：`界面 → 运行时 → 横切`。

> **为什么运行时层不许碰 vscode**：这是 Rule 1 的目的。
> 它让同一份 `AgentLoop` 能同时跑在 VS Code / 评测沙箱 / 单元测试里。

**主循环长这样**（`src/agent/loop.ts`，改造后只有 9 行）：
```typescript
while (true) {
  for (const op of this.pipeline) {
    const result = await op.run(ctx);
    if (result.status === 'yielded') return result.output;
  }
  ctx.iteration++;
}
```

**9 个 Operation 的执行顺序**（顺序就是依赖关系，不能随便换）：
```
abort → max_iterations → user_prompt_submit → steer_inject → todo_inject
      → context_guard → inference → tool_execution → stop_hook
```

**三个状态**：`not_applicable`（跳过）/ `applied`（继续）/ `yielded`（结束）

---

## 🔧 怎么加一个新东西

### 加一个工具（4 步）

1. **写实现** → `src/agent/tools/xxx.ts`
   ```typescript
   export class XxxTool implements Tool {
     readonly name = 'xxx';
     readonly description = '一句话说清它干什么（模型全靠这句决定要不要用）';
     readonly parameters = { type: 'object', properties: {...}, required: [...] };
     readonly meta = readOnlyMeta();      // ⚠️ 必须显式声明，见 Rule 2
     async execute(args: any): Promise<ToolResult> { return { content: '...' }; }
   }
   ```
2. **注册** → `src/agent/tools/factory.ts` 里 `register(new XxxTool())`
3. **加进 `ALL_TOOL_NAMES`**（工具名的唯一真相源）
4. **写测试** → `src/__tests__/tools/xxx.test.ts`
   > ⚠️ **不要忘第 4 步**。忘了 `npm run check` 会红。

**约定**：
- `execute()` 里**不要**包 `<untrusted_content>`（Rule 3）
- 有副作用 → 走 `approval.ts` 的审批 + `checkpoint/store.ts` 的快照
- 输出很大 → `util/toolOutputStore.ts` 会自动外置，你不用管

### 加一个 Operation（3 步）

1. 建 `src/agent/operations/xxx.ts`
   ```typescript
   export const xxxOperation: Operation = {
     name: 'xxx',
     async run(ctx): Promise<OperationResult> {
       if (!条件) return notApplicable();   // 这轮不适用，跳过
       return applied();                     // 做了事
     },
   };
   ```
2. 在 `src/agent/operations/index.ts` 的 `buildPipeline()` 里加一项
   （**位置就是执行顺序**，想在哪跑就放哪）+ 同步 `ALL_OPERATION_NAMES`
3. 写单测 → `src/__tests__/operations.test.ts`（给个假 ctx 就行，不用 mock 整个 vscode）

**约定**：
- Operation **不许碰 vscode API、不许直接读写文件**
- 需要跨步骤共享的状态放 `ctx.state`（Rule 4）
- 想让消息永不被压缩 → 打 `pinned: true`

### 加一个 Provider（1 步）

改 `src/agent/provider.ts` 的 `PROVIDER_CONFIGS` 一张表，加一行。
**加 provider 不用改任何其他文件。**

---

## 🪤 踩过的坑（别再踩）

| 坑 | 症状 | 正确做法 |
|---|---|---|
| **压缩把 assistant + tool 拆散** | provider 400，**永久 400，重试没用** | 压缩时把「assistant + 它后面所有 tool 消息」当**一个整体**保护，用游标遍历不要预先 slice |
| **上下文压缩把待办压没了** | 多步任务从头再来 | 给待办消息打 `pinned: true`；`filterForModel` 会**永久**过滤掉 `agentVisible=false` 的消息 |
| **prompt 教了不存在的工具** | 模型去调一个被摘掉的工具，白烧一轮 | `ContextBuilder` 接 `toolNames` 参数，**按实际可用工具拼 prompt** |
| **provider 不支持 `stream_options`** | 400 | 摘掉这个字段**重试一次**（`provider.ts` 里有降级逻辑） |
| **Windows 上 cmd.exe 报错乱码** | 报错信息是乱码 | cmd.exe 输出是 **GBK**，Node 按 UTF-8 解码会花 |
| **Windows 上 SIGTERM 不生效** | 子进程杀不掉 | 补 **SIGKILL** 兜底 |
| **评测题文件用了 CRLF** | **标准答案自己都跑不过** | 评测题文件**必须保持 LF 换行** |
| **`.vscodeignore` 不读 `.gitignore`** | 280KB 评测产物 + 整个前端 node_modules 被打进 VSIX | `vsce` 只读 `.vscodeignore`，两份要各自维护 |
| **`out/__tests__/` 被打进包** | 编译后的测试代码进了 VSIX，还会触发 vsce 的密钥扫描 | 显式排除 `out/__tests__` 和 `out/eval` |

---

## 🛠 常用命令

```powershell
npm test                 # 529 个用例（约 95s）
npm run check            # 架构守卫（7 项）—— 提交前必跑
npm run compile          # tsc
npm run eval             # 全量 30 题评测（约 ¥3.9）
npm run eval:dry         # 只验证评测框架链路，不花钱
npm run eval:solvable    # 验证每道题的标准答案都能跑通（证明题不是废题）
npm run eval:repeat 3    # 同一批题跑 3 次，看方差
npm run eval:ablate grep # 消融：摘掉 grep 工具看结果变差多少
npm run audit            # 对真实项目做改造分析
npm run vscode:package   # 打 VSIX
```

**提交前检查清单**：
```powershell
npm run check && npm test && npm run compile
```

---

## 🎨 这个项目在设计上做过的"取舍"

> 写代码前先想清楚"为什么不用更简单的做法"。
> 这些取舍**都写了理由**，改之前先读对应文件的注释。

| 决策 | 位置 | 一句话 |
|---|---|---|
| **拒绝 LLM-as-judge 权限判定** | `agent/tools/approval.ts:24-32` | 慢、烧钱、**判权限这件事本身就能被注入攻击**、不可预测 |
| **双可见性**（压缩不删历史） | `agent/visibility.ts` | 用户要能回看 agent 当时看到了什么；压缩因此**可逆** |
| **信任边界打在管线出口** | `agent/trust.ts` | 单一收口 → 新工具不会漏打标记 → 默认安全 |
| **只读并行、写严格串行** | `agent/tools/partition.ts` | 两个 patch 改同一文件会互相覆盖；两个审批弹窗会同时弹给用户 |
| **主循环管线化** | `agent/loop.ts` | 1075 行 → 211 行；新增能力 = 往管线加一项，不改主循环 |
| **静态元数据而非运行时判定** | `agent/tools/meta.ts` | 静态元数据不认识"这次参数危不危险"，但对 VS Code 插件场景够用 |

---

## 📌 最后三条

1. **先了解再动手** —— 动手前先 `list_dir` / `grep` / `read_file`，不要盲改。
2. **改完必须验证** —— 改完跑测试，确认没破坏其他功能。
3. **不要生造内容** —— `read` 不到就说不存在，不要瞎编。承认错误，发现改错立刻 `restore_file` 回滚。

---

*本文件由 Mini-Coder 自己加载（见 `src/agent/context.ts:34`）。*
*改完记得验证：让 agent 问一个只有本文件里才有的问题，看它答不答得出来。*
