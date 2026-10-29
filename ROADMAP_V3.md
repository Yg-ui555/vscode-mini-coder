# vscode-mini-coder · 第三阶段路线图（Phase 9 ~ Phase 11）

> 生成时间：2026-10-27
> 输入：对 `vscode-mini-coder`（TS，VS Code 插件，v0.4.0）的**全代码实测复核**，
> 以及 `goose-main`（Rust，Block）、`nanobot-main`（Python，HKUDS）的完整代码阅读
> 前置：`ROADMAP.md`（Phase 1/2）、`ROADMAP_V2.md`（Phase 3~8，**已全部完成**）
> 本文件只回答一个问题：**接下来 6 周做什么。**

---

## 术语表（先看懂名词再往下读）

| 术语 | 通俗解释 | 类比 |
|---|---|---|
| **CI（持续集成）** | 每次提交代码，服务器自动帮你跑一遍测试 | 流水线工人站在产线末端，每个产品都自动过一遍质检 |
| **MCP** | 让 agent 接入外部工具的一套统一插头标准 | 统一的插座规格，不用每个厂家自己接线 |
| **stdio（标准输入输出）** | 程序之间用管道传数据的一种方式 | 两台机器用一根水管对话 |
| **JSON-RPC** | 一种"发问-回答"式通信格式，每条消息带编号 | 取号排队，喊到号才回答 |
| **作用域审批** | 用户点一次"以后都允许"要**绑定到具体命令**，不是绑定到工具名 | 门禁卡只对"工位 3 号"有效，不是刷开整栋楼 |
| **AGENTS.md** | 项目自己写的"给 AI 看的说明书"，业界约定文件名 | 员工手册，新人入职先读这个 |
| **动态工具注册表** | 工具不是开机时定死的，而是随时能增减 | 公司的工牌系统：新员工入职发牌，离职收回 |
| **广告工具清单** | 本轮告诉模型"你能用这些工具"的那份名单 | 会议开始时念一遍与会者名单，念过的人才能发言 |
| **record/replay（录制回放）** | 把模型调用录下来，之后用录像代替真人，测试不花钱 | 考驾照用回放录像，而不是每次都请教练陪练 |
| **pass rate** | 评测集里做对的比例 | 考试的及格率 |
| **饱和** | 题目太简单，全都对，尺子量不出差别 | 体温计量不出发烧了——不是没病，是尺子坏了 |
| **消融实验（ablation）** | 把某个能力拆掉，看结果变差多少 | 拆掉汽车的一个零件，看车还能不能开 |
| **Dogfooding** | 自己吃自己的狗粮，即用自己做的产品干活 | 厨子先端一盘自己做的菜 |

---

## 零、先说结论（只读一节的话读这节）

**ROADMAP_V2 的 Phase 3~8 已经全部做完了。**主循环管线化、Todo、子智能体、插话、
OTel 风格追踪、Hook 机制、CI 文件、架构守卫、ARCHITECTURE.md、v0.4.0、简历面试包——
本地全在，**529 个测试全绿，架构守卫 7 项全过**。

**但现在最要命的问题不是"功能不够"，是"造好的东西没人看得见"。**

> **比喻：你造了一台手工引擎的车，底盘、涡轮、变速箱全是自己锻的，
> 还搭了一条专业试车跑道（评测集 + 消融 + 方差统计）。**
> **但车还停在自家车库，钥匙没插；保险没买（CI 从没跑过）；连车牌都没上（没有 Release）；
> 车标上写着"MCP 认证"，但发动机里根本没装 MCP 模块。**

### 实测证据（2026-10-27，全部现场跑出来的，不是自述）

| # | 事实 | 证据 | 后果 |
|---|---|---|---|
| **1** | 🔴 **21 个提交从没推过** | `git log origin/master..master` → 21 条；GitHub `pushed_at` 停在 `2026-10-23T12:07:19Z` | 面试官点开你简历里的 GitHub 链接，看到的是 **10 月 23 日的旧版**——没有 Todo、没有子智能体、没有架构文档、没有 CI |
| **2** | 🔴 **CI 从未运行过一次** | GitHub API `actions/runs` → `total_count: 0` | README 顶部挂着一个**永远是灰的徽章**。"CI badge"是简历上最不值钱也最致命的装饰——它不说话，但会说话 |
| **3** | 🔴 **CI 触发分支写错了** | `.github/workflows/ci.yml:40` 写 `branches: [main]`，仓库实际分支是 `master` | 就算推上去也**永远不会触发**。这是"配了 CI 但没跑过"的直接技术原因 |
| **4** | 🔴 **GitHub Release 数量 = 0** | API `releases` → `[]`；本地有 tag `v0.4.0` 但没发 Release | 简历里写"已发布 v0.4.0"→ 面试官一点 404。**这不是小事，是信誉问题** |
| **5** | 🔴 **仓库 topics 写了 `mcp`，代码里 0 个 MCP** | `src/` 全仓 grep `mcp` → 2 处误命中；GitHub topics 含 `mcp` | 自己给自己挖坑：面试官 grep 一下发现没有。要么删 topic，要么真的做 |
| **6** | 🟡 **README 数字前后不一致** | README:588 写"9 个工具"，实际 11 个；README:524/558 写"30 题"，README:615 写"最近一次评测（23 题）"；ARCHITECTURE.md:8 写测试"38 文件 / 7,917 行"，实测 37 文件 / 7,574 行；webview 写 1,002 行，实测 995 行 | 这个项目的**核心卖点就是"每条数字都能复现"**。数字对不上，等于把唯一的护城河自己拆了 |
| **7** | 🟡 **30 题的完整评测没跑过** | `eval/RESULTS.md` + `results.json` 都是 23 题 / 2026-10-24 的旧数据；题库已扩到 30 题 | 简历写"30 题"，报告证明的是"23 题"。**而且 7 道新题到底能不能测出东西，目前是未知的** |
| **8** | ✅ 内功是 95 分 | 529 用例全绿 / 架构守卫 7 项过 / 11 个工具 / 11 个 Operation / 30 题+30 答案 | 不用怀疑技术能力。**问题全在"最后一公里"** |

### 核心判断

> **接下来 6 周的战场只有两件事，一件都不能少：**
>
> **① 让别人看见（Phase 9）—— 1~2 天，零成本，回报最大。**
> 你的项目"能不能被验证"，目前**完全不能**。补上推送 / CI / Release / 数字校正，
> 相当于给一辆造好的车**装上牌照、买好保险、放进展厅**。这一步不做，后面所有工作都白干。
>
> **② 补上 agent 岗的"入场券"（Phase 10）—— 约 3 周。**
> 2026 年 agent 岗面试，**MCP 必问**。goose 有 `goose-mcp` 整个 crate，
> nanobot 有 2.5k 行 MCP 客户端。你两个都没有——
> 而且你**仓库 topic 已经写着 mcp 了**，现在是"空头支票"状态。

### ⭐ 一个改变工作量的好消息（我实测出来的）

**你的架构已经是"MCP-ready"的，MCP 接入的难度比 ROADMAP_V2 预估的低一个数量级。**

| 证据 | 位置 | 为什么重要 |
|---|---|---|
| 工具 schema **每轮实时计算** | `src/agent/operations/inference.ts:65` → `ctx.registry.schemas` | MCP 服务器在运行时才吐出工具，**不需要重启对话**，下一轮 LLM 调用自动带上新工具 |
| 注册表 `register()` 是公开方法 | `src/agent/tools/registry.ts:24` | 运行时注册工具天然可行，不用改架构 |
| **"本轮广告过的工具"一致性校验已存在** | `src/agent/operations/toolExecution.ts:99-108` + `inference.ts:120` | 这正是 goose 的铁律（`crates/goose-agent/src/tool.rs:119-122`：*"工具名在广告到调用处理完之间必须保持稳定"*）。**你已经有了** |

> **比喻：**造一台能装涡轮发动机的车最难的是**底盘和传动系**——
> 你已经把这两样造好了（动态注册表 + 协议一致性校验），
> 现在只要把涡轮装上去（写个 MCP 客户端），动力就来了。
> ROADMAP_V2 里"MCP 要 200KB+ 代码量"的估算，是把 nanobot 的**全量矩阵**
> （stdio + HTTP + SSE + OAuth + SSRF 防护 + 7 家 provider 的 schema 归一化）
> 算进去了。**你只需要 stdio 一条路。**

---

## 一、Phase 9：止血 —— 把造好的东西推出去（W0，1~2 天）

> **为什么第一件事是这个**：后面所有优化都要靠评测验证效果。
> 但更前置的是——**你做的东西得先存在于世界上**。
> 比喻：你写完了一本书，但没交稿、没出版、没上架，图书馆里没有。
> 面试官说"你把书给我看看"，你说"在我硬盘里"——**这句话在面试里等于零分**。

### 任务 9.1：推送 21 个提交 + 修 CI 分支名（W0 前半，30 分钟）

**第一步：修 CI 触发分支**（这是根因，不修就白推）

`.github/workflows/ci.yml:39-42`：
```yaml
on:
  push:
    branches: [main]      # ❌ 仓库实际是 master
  pull_request:
    branches: [main]      # ❌
```

改成 `master`（或者反过来把仓库主分支改名成 `main`——**推荐改 CI**，因为
`git symbolic-ref refs/remotes/origin/HEAD` 显示 GitHub 默认分支已经是 `master`，
改仓库分支会让已有的 tag / 链接全部要跟着改，风险大得多）。

> ⚠️ **顺带确认**：`schedule: cron '0 18 * * *'` 定时任务只在**默认分支**上跑，
> 默认分支是 `master`，所以定时评测**会**跑。修完 push 分支后，
> 定时任务会和手动 push 同时触发，要用 `concurrency` 段去重——**你已经有了**
> （`ci.yml` 里有 `concurrency: group: ci-${{ github.ref }}`），确认一下定时任务
> 是否需要单独的 group 名，否则定时评测会被 push 触发的任务取消掉。

**第二步：推送**

```powershell
git push origin master --follow-tags
```

**第三步：验证 CI 真的跑了**（这一步不能省）

> ⚠️ ROADMAP_V2 自己写了这句话，我再强调一遍：
> *"故意推一个失败的测试，CI 必须变红（**一定要验证这一步**，否则你不知道 CI 到底跑没跑）"*
>
> **光看徽章变绿不算验证**——徽章可能来自缓存、可能来自别的 job。
> 正确验证：打开 Actions 页面 → 看 **job 的 step 日志** → 确认它真的跑了 `npm test`。
> 然后**故意改坏一个测试再推一次**，看它变红，再改回来。

**验收标准**：
- [ ] GitHub Actions 页面能看到 ≥1 次成功运行，**日志里能看到 `npm test` 的 529 passed**
- [ ] README 顶部 CI 徽章变成**绿色**（不是灰色）
- [ ] 本地 `git log origin/master..master` 输出为空

---

### 任务 9.2：重跑 30 题全量评测（W0 前半，20 分钟 + ¥4）

**为什么必须做**：README 徽章写"30 题"，但 `eval/RESULTS.md` 证明的是 23 题。
**简历上写"30 题"而报告证明"23 题"，面试官一对照就是"数据不实"。**

```powershell
npm run eval
```

成本约 **¥3.9**（30 题 × ¥0.13）。一次投入，终身受益——因为报告会写进 README 证据段、
写进简历、也会被面试官翻到。

**跑完立刻看三个数**：
1. **pass rate 落在多少？** 如果还是 100% → 说明 7 道新题也是送分题，
   Phase 11 就有活干了（这不丢人，但要知道）。
2. **哪些题最贵？** `RESULTS.md` 有"最贵的 3 题"表。如果一道题烧 ¥0.35，
   要问"为什么"——通常是工具重复调用打转。
3. **有没有回归？** `regressed` 必须是 0。

> **一个纪律**：**每次改动 agent 行为后，都要重跑一次全量评测并把 `eval/RESULTS.md`
> 一起提交**。这样 `git log -p eval/RESULTS.md` 就是一条**能力曲线**，
> 面试官可以自己翻看你每一次优化的效果。
> ⚠️ 注意 `eval/results.json`（280KB 原始数据）在 `.gitignore` 里 —— 它每次跑都变，
> 进版本库没意义。**跟踪的是整理过的 `RESULTS.md`，这两个不是一回事。**
> **这是 goose 和 nanobot 都没有的东西**——nanobot 根本没有评测框架。

**验收标准**：
- [ ] `eval/RESULTS.md` 和 `eval/results.json` 的 `total` = 30
- [ ] `eval/RESULTS.md` 顶部的日期是今天
- [ ] README 徽章的"30 题"和报告对得上

---

### 任务 9.3：数字一致性校正（W0 后半，1 小时）

**这个项目最大的资产是"每条数字都能复现"。数字对不上，等于自毁长城。**

| 文件 | 现在写的 | 实际是多少 | 怎么改 |
|---|---|---|---|
| `README.md:588` | 9 个工具 | **11 个** | 改 |
| `README.md:524,558` | 30 题 | 30 题（✅ 对） | 保持，但要确保 9.2 跑完 |
| `README.md:615` | 最近一次全量评测（23 题） | 9.2 跑完就是 30 题 | 改 |
| `README.md` 徽章 | eval-30 题 · 100% | 跑完才知道 | 跑完更新 |
| `ARCHITECTURE.md:8` | 测试 38 文件 / 7,917 行 | **37 文件 / 7,574 行** | 改 |
| `ARCHITECTURE.md:10,196` | webview-ui 1,002 行 | **995 行**（含 styles.css 479） | 改 |
| `ARCHITECTURE.md:8` | src 84 文件 / 17,548 行 | ✅ **对**（用文档里那条命令能精确复现，已验证） | 保持 |

> ✅ **一个好消息**：`17,548 行`这个数字我实测过**能精确复现**——
> 用 `docs/RESUME.md:198` 给的那条命令（`ReadAllText -split "\n"`）跑出来正好是 17,548。
> 这说明你做数字的口径是严谨的，**别把这个方法改掉**。
>
> ⚠️ 但要注意：`Get-Content | Measure-Object -Line` 出来是 14,492（不计空行），
> `Get-Content` 的 `.Count` 是 16,269。**三个数都不一样**。
> 所以**简历里必须写清楚口径**，并且只用一个口径。
> 建议统一用 `ReadAllText -split "\n"`（你现在的口径），并在 `docs/RESUME.md` 里
> 把"为什么用这个口径"写成一句话：
> *"按物理行数统计（含空行），因为空行也是代码结构的一部分；
> 用 `Measure-Object -Line` 会低估 17%，因为它不计空行。"*

**验收标准**：
- [ ] `grep -rn "9 个工具\|23 题\|7,917\|1,002 行" README.md ARCHITECTURE.md docs/RESUME.md` 无输出
- [ ] 每条数字都能用文档里给的命令复现

---

### 任务 9.4：发 GitHub Release v0.4.0 + 修正 topics（W0 后半，1 小时）

**Release 是"这是真的"最强的证据。** GitHub 页面上的 `Releases 1` 比 README 里
任何一句话都有说服力——因为它意味着**有人打包过、有人下载过**。

```powershell
# 1. 确认 tag 在远端
git ls-remote --tags origin

# 2. 用已有的 CHANGELOG.md（Keep a Changelog 格式）生成 Release 正文
#    手工写一段"这个版本有什么、怎么装、怎么验证"
```

**Release 正文至少包含**（面试官会照着看）：
1. 一句话定位 + 关键数字（529 用例 / 11 工具 / 30 题评测）
2. **安装方式**：Marketplace 链接 或 下载 `.vsix` 的步骤
3. **3 分钟上手**：配 API Key → 打开面板 → 说一句话
4. **验证清单**：`npm test` 全绿 / CI 绿 / 评测报告链接
5. 已知限制（**主动写限制 = 显得专业**，面试官会觉得你诚实且有判断力）

**顺手修 topics**：现在 topics 是
`agent, ai, ai-agent, byok, code-assistant, llm, mcp, react, typescript, vscode-extension`
—— **`mcp` 必须删掉**，除非 Phase 10 做完再补回来。
> **比喻**：简历上写"我精通焊接"，结果面试官看一眼手上没焊过——
> 这不是"还没学"，是"不诚实"。**先把标签摘掉，等真做了再加回去，那才叫迭代。**

**验收标准**：
- [ ] GitHub 仓库页面右侧显示 `Releases 1`，点进去能看到 v0.4.0 + VSIX 附件
- [ ] topics 里没有 `mcp`（Phase 10 做完再加）
- [ ] Release 正文里每条数字都能在仓库里找到出处

---

### 任务 9.5：写 `AGENTS.md`（W0 后半，1 小时）⭐

**这是 nanobot 独有的、极其便宜的高价值产出。**

nanobot 有一个 `.agent/` 目录，里面是给 AI 读的**操作纪律文档**，
格式是显式的 `**Rule:**` 语句：

| nanobot 的文件 | 内容 |
|---|---|
| `.agent/design.md` | 所有权边界、扩展点、"**核心保持小，扩展在边缘**" |
| `.agent/security.md` | 路径 / SSRF / 沙箱不变量，写成 `**Rule:**` |
| `.agent/gotchas.md` | 环境变量语法、Windows 差异、"**上下文污染会持久**" |
| `.agent/simplify.md` | 重构原则 |

**你已经有全部素材了**——你的代码注释里全是这些内容
（`ARCHITECTURE.md` 的六个设计决策、`approval.ts:24-32` 的"为什么不学 goose 的 LLM judge"、
`delegate.ts` 的三条铁律、`historyRepair.ts` 的协议约束）。
**现在只是把它们从代码注释里"提上来"，变成一份给 AI 和新人看的顶层契约。**

**你项目自己的 `AGENTS.md` 应该长这样**（这同时是 Phase 10 的产品功能基础）：

```markdown
# AGENTS.md —— 给 AI 协作者的说明书

> 这个文件有两类读者：① 别的 AI 工具（Cline / Copilot / Cursor）
> ② 第一次接触这个仓库的人类开发者。
> 两者都需要的是同一份东西：**这个仓库的规矩**。

## 项目一句话

VS Code AI 编程助手。ReAct Agent 运行时 + 自研回归检测评测体系。TypeScript，无运行时依赖。

## 硬性规矩（违反就是 bug，不是风格问题）

**Rule 1：Agent 运行时层不允许 import `vscode`。**
  原因：同一份 AgentLoop 要能同时跑在 VS Code、评测沙箱、单元测试里。
  位置：src/agent/**
  验证：scripts/checkProject.js 的 file-size / 结构检查 + 单元测试不需要 vscode stub 就能跑

**Rule 2：新增工具必须用带副作用的 meta。**
  原因：权限档位靠 meta.readOnly 静态映射，用错了就是越权。
  位置：src/agent/tools/*.ts
  验证：npm run check 会检查 ALL_TOOL_NAMES 与注册表一致

**Rule 3：工具的 execute() 只管取数据，不要在里面加安全声明。**
  原因：信任边界在管线出口统一处理（<untrusted_content> 标记），
        逐个工具包会漏掉 run_shell。
  位置：src/agent/operations/toolExecution.ts

**Rule 4：不要在 src/agent/ 下用模块级可变状态存跨轮数据。**
  原因：评测时多题并发会串味。跨步骤共享放 ctx.state。
  位置：src/agent/operations/types.ts 的 OperationContext

**Rule 5：改了 agent 行为，必须重跑 npm run eval 并提交 eval/RESULTS.md。**
  原因：这个项目卖的是"可验证"。没有评测数据 = 没有证据。

## 架构速览
（贴 ARCHITECTURE.md 的那张 Mermaid 图 + 20 行模块表）

## 怎么加一个新工具 / Operation / Provider
（贴 ARCHITECTURE.md 第 6 节）

## 已知坑（踩过的，别再踩）
- Windows 下 cmd.exe 报错是 GBK 编码，Node 按 UTF-8 解码会乱码
- 评测题文件必须保持 LF 换行，否则标准答案自己都跑不过
- 压缩上下文时 assistant(带tool_calls) 和它后面的 tool 消息必须整体保护，不能拆散
- provider 不支持 stream_options 时要摘掉再试一次
```

**为什么这个文件值得单独花一小时**：
1. **它是"给 AI 看的项目上下文注入"的标准载体**——goose 读 `.goosehints` / `AGENTS.md`，
   nanobot 读 `AGENTS.md` / `SOUL.md` / `USER.md`，Claude Code 读 `CLAUDE.md`。
   **2026 年的 agent 生态，"读项目自己的 AGENTS.md"是基本功。**
2. **它是你 Phase 10 的"AGENTS.md 自动加载"功能的测试床**——先手写一份，
   再让插件自动读它，闭环。
3. **它在面试里是"工程素养"的直接证据**——大多数学生项目没有这个文件。

**验收标准**：
- [ ] 根目录有 `AGENTS.md`
- [ ] 至少 5 条 `**Rule:**`，每条都写清"为什么"和"在哪验证"
- [ ] 别人（或者一个 AI）只读这个文件，就能加一个新工具

---

### 任务 9.6：把"不要做"清单更新一下（W0，10 分钟）

ROADMAP_V2:1134 写着：
> **MCP 接入** —— 200KB+ 代码量。VS Code 用户已有 Copilot 等 MCP 生态，
> 你再做一套是重复建设，且你没时间做深。**但简历里可以写"评估过 MCP 接入并给出不做的技术判断"**

**这条判断，Phase 9 做完之后必须推翻它。** 理由：

| 当时的理由 | 现在为什么不成立 |
|---|---|
| "200KB+ 代码量" | 那是 nanobot 的**全量矩阵**（stdio + HTTP + SSE + OAuth + SSRF + 7 家 provider 的 schema 归一化）。**你只需要 stdio 一条路**，实测你的注册表和协议校验已经是 MCP-ready，工作量低一个数量级 |
| "VS Code 用户已有 Copilot 的 MCP 生态，再做一套是重复建设" | **Copilot 是竞品不是生态。**你要证明的是"你能把 agent 接进任意 MCP 服务器"，不是"你能造一个更好的 Copilot"。**接进去 ≠ 重复建设** |
| "简历里可以写'评估过并给出不做的技术判断'" | 这话**现在不成立**——因为你 GitHub topic 已经写了 `mcp`。**空头支票比诚实的"没做"伤害大得多** |
| — | **2026 年 agent 岗面试，MCP 是必问题。**goose 有整个 `goose-mcp` crate，nanobot 有 2500 行 MCP 客户端。你不会，会被直接问住 |

> **比喻**：ROADMAP_V2 当时的判断是"造涡轮发动机投入太大，先不造，车照样能开"。
> 这在 2026-10-23 是对的。**但两天后市场变了**——现在车要上赛道，
> 没涡轮的排气管会被查。而且更关键的是：**你车上贴了"涡轮"标签。**

**所以 Phase 9.6 = 把 9.4 的 topics 修正 + 更新"不要做"清单**（清单见第九节）。

---

## 二、Phase 10：补上 agent 岗的入场券（W1~W3，3 周）

> **为什么这三件事，而不是别的**：
> 我把 2026 年 agent 应用岗 JD 里反复出现的词，和 goose / nanobot 的实际代码对照了一遍。
> 结论是：**你已经有 Todo（多步任务状态管理）、子智能体（上下文隔离）、
> OTel 风格追踪（运行时可观测）**——ROADMAP_V2 说的"三大硬考点"你已经全做完了。
> **真正缺的只有两件：**
>
> - **生态接入能力**（MCP）—— 你现在是"自己造了一个玩具 Ecosystem"，跟真实世界没连上
> - **上下文来源**（AGENTS.md / 项目约定）—— 真实 agent 必须读懂"这个项目的规矩"
>
> 外加一件**信任特性**：作用域审批（用户点一次"以后都允许"要绑定到具体命令）。

### 任务 10.1：MCP 客户端（stdio 优先）（W1，3 天）⭐⭐⭐

**这是整个 Phase 10 的核心，也是本路线图里唯一"非做不可"的项。**

#### 10.1.1 MCP 协议到底有多简单（先消除恐惧）

MCP 在 stdio 传输下的全部内容，就是**用管道传 JSON-RPC 2.0 消息**：

```
客户端 → 服务器：  {"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
服务器 → 客户端：  {"jsonrpc":"2.0","id":1,"result":{"capabilities":{"tools":{}}}}
客户端 → 服务器：  {"jsonrpc":"2.0","method":"notifications/initialized"}
客户端 → 服务器：  {"jsonrpc":"2.0","id":2,"method":"tools/list"}
服务器 → 客户端：  {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"search","description":"...","inputSchema":{...}}]}}
客户端 → 服务器：  {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search","arguments":{"q":"..."}}}
服务器 → 客户端：  {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"..."}]}}
```

**就这些。** 你已经写过流式 SSE 解析（`provider.ts` 的 `_streamInner`，
逐行 `JSON.parse` + buffer 拼接），**解析逻辑可以照抄那个模式**。

> **比喻**：MCP 就是"跟外部程序用管道说 JSON 话"。
> 你已经会跟 LLM 说话了（OpenAI 兼容协议），
> 现在只是**换个对象说同一种话**。

#### 10.1.2 架构设计（4 个新文件）

```
src/agent/mcp/
  ├─ protocol.ts      (150 行) JSON-RPC 2.0 消息类型 + 编解码
  ├─ stdioClient.ts   (250 行) 子进程管理 + 请求/响应配对 + 超时
  ├─ manager.ts       (200 行) 多服务器管理 + 工具注册表同步
  └─ schemaNormalize.ts (120 行) MCP schema → OpenAI function schema 归一化
```

**关键设计决策（面试要讲）：**

| 决策 | 做法 | 理由 |
|---|---|---|
| **传输层只做 stdio** | 不做 HTTP / SSE | 砍掉 70% 代码量和 90% 的边界情况（OAuth / SSRF / 重连）。VS Code 生态里本地 MCP server（filesystem / git / postgres）全是 stdio，**覆盖 90% 的真实需求** |
| **工具命名 `mcp__<server>__<tool>`** | 例：`mcp__filesystem__read_file` | 业界惯例（Claude Code 同款）。防命名冲突，且模型一眼看出工具来自哪 |
| **命名空间前缀参与权限判定** | MCP 工具默认走 `askAll` 档 | **MCP 服务器是外部程序，它返回的内容一律按"不可信数据"处理**——这直接接上你已有的 `<untrusted_content>` 信任边界 |
| **只读 server 自动放行** | server 声明 `readOnlyHint: true` 时按只读处理 | 这是 MCP 规范自带的字段（`ToolAnnotations.readOnlyHint`），白嫖的标准 |
| **失败降级而不是崩** | 服务器起不来 → 跳过它，其余工具照常 | 比喻：外卖少点一家，不影响吃饭。**不能因为一个第三方 server 挂了就整个 agent 瘫痪** |
| **子进程跟随扩展宿主生命周期** | 激活时启动 / 停用时 kill | 避免留下孤儿进程 |

#### 10.1.3 schema 归一化（nanobot 踩过的坑，直接抄）

nanobot 的 `nanobot/agent/tools/mcp.py` 2500 行里，最值钱的是
`_normalize_schema_for_openai`（`:502-507`）和 `_rewrite_local_schema_refs`（`:395-448`）：

**MCP 的 `inputSchema` 是完整 JSON Schema，可以带 `$ref` / `$defs` / `oneOf` / `anyOf`；
但很多 OpenAI 兼容后端（DeepSeek / MiniMax / 一些自建网关）只认扁平 schema。**

至少要处理这 4 种：
1. `$ref: "#/$defs/Foo"` → **内联展开**（或转成 `anyOf`）
2. `type: ["string", "null"]` → `type: "string"` + `nullable: true`
3. `additionalProperties: false` → 保留（有些后端不支持，去掉更安全）
4. `anyOf` → 保留（OpenAI 支持，但 `oneOf` 要降级成 `anyOf`）

> **为什么这段值得单独花 1 小时**：模型看到一份后端不认的 schema，
> 轻则调用失败，重则**幻觉出错误的参数**。nanobot 花了几百行踩坑才总结出来，
> 你抄 120 行就省掉几天的 debug。**这就是读参考项目的意义。**

#### 10.1.4 配置文件格式

```jsonc
// .vscode/mini-coder-mcp.json（工作区级，提交进 git）
{
  "servers": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"],
      "env": { "ROOT": "${workspaceFolder}" }
    }
  ]
}
```

**设计要点（这几个都是面试可讲的细节）**：
- **工作区级配置文件**放 `.vscode/`（跟 VS Code 生态一致，用户不用学新路径）
- **全局级**放 `context.globalStorageUri`（换仓库也保留）
- `${workspaceFolder}` 变量替换（VS Code 生态标准，用户已经会了）
- **走审批流程**：MCP 服务器要执行外部程序 → 必须过你的权限档位 +
  首次启动弹一次确认（"允许启动 MCP 服务器 filesystem 吗"）
- **配置里的 token 不进日志**（你有 `src/agent/tools/redact.ts` 脱敏层，直接复用）

#### 10.1.5 测试策略（关键：不能靠烧钱测）

**这是 goose 最值得抄的一个测试模式**：goose 有 **MCP record/replay**
（`crates/goose/tests/mcp_integration_test.rs` + `crates/goose/tests/mcp_replays/*.results.json`，
用 `GOOSE_RECORD_MCP=1` 环境变量重录）。

**你的做法**：
1. **单元测试用假 server** —— 写一个 `FakeMcpServer`（一个 node 脚本，
   按 JSON-RPC 吐固定响应），测客户端的请求配对、超时、错误处理
2. **集成测试录制真实 server** —— 对 `server-filesystem` 录一次，
   存成 `src/__tests__/fixtures/mcp-replays/*.json`，
   之后 CI 用回放，**零 API 成本、零网络依赖、结果确定**
3. **至少 5 个用例**：握手成功 / 服务器起不来 / 超时 / 工具名冲突 / schema 归一化

> **比喻**：你已经有了"试车跑道"（评测集），
> 现在再加一条"**回放赛道**"——录一段真实赛车，之后每天在回放赛道上跑，
> 不烧油、不看天气、结果永远一致。
> **面试时这句话很有分量**："agent 的 LLM 调用天生不确定，
> 所以我用 record/replay 把 MCP 层的测试变成了确定性的。"

#### 10.1.6 验收标准

- [ ] 配置一个 MCP server（比如 `@modelcontextprotocol/server-filesystem`），
      agent 能列出它的工具、能调用、能拿到结果
- [ ] `mcp__filesystem__read_file` 这种带命名空间的工具名正确出现在给 LLM 的 schema 里
- [ ] MCP 服务器起不来时，agent 仍能正常用原生 11 个工具工作
- [ ] ≥5 个 MCP 单元测试（含 record/replay）
- [ ] `npm run check` 增加一条新检查：MCP 工具名必须带命名空间前缀
- [ ] README 有「MCP 支持」章节，含一段 GIF 或文字演示
- [ ] **GitHub topic `mcp` 加回去**（这时它是真话了）

---

### 任务 10.2：项目约定的【子目录懒加载】+ 脱敏（W2 前半，1.5 天）

> ⚠️ **2026-10-27 修正（重要）**：本任务初稿写的是"新增 AGENTS.md 自动加载"。
> **复核代码后发现：根目录加载已经实现了**（见下方"已完成"），
> 所以本任务只剩【三块缺口】，工作量从 3 天降到 1.5 天。

#### ✅ 已完成（不用再做）

`src/agent/context.ts:223-260` 的 `_loadBootstrapFiles()` 已经做到：

| 已有能力 | 位置 |
|---|---|
| 自动加载 `AGENTS.md` / `SOUL.md` / `USER.md` | `context.ts:34` 的 `BOOTSTRAP_FILES` |
| 单文件 50KB 上限（防撑爆 prompt） | `context.ts:37` `MAX_BOOTSTRAP_BYTES` |
| 读取失败静默跳过，不阻塞 agent | `context.ts:246-249` |
| 注入到 system prompt，**不写进消息历史** | `context.ts:82` `buildSystemPrompt()` |

> **这已经是 Phase 10 里"上下文来源"那块的 60% 了。**

#### ❌ 剩下的三块缺口

**缺口 A：子目录懒加载（goose 模式，1 天）**

goose 的 `crates/goose/src/hints/load_hints.rs`：
- `:10-11` 识别 `AGENTS.md` 和 `.goosehints`
- `:42` **监听工具调用参数里的 `path` / `command`** ——
  agent 碰了哪个目录，才把那个目录的 AGENTS.md 注入
- `:87` 要求目录在工作目录内；`:128` 找到 git 根就停

> **比喻**：你不会把整本《员工手册》塞进每一个新人的脑子。
> 你在他坐到"财务部工位"时，才把财务部的规章给他看。
> **上下文工程的核心不是"塞更多"，是"在对的时刻塞对的"。**

你的根目录已经"永远注入"了（正确），**缺的是子目录这一层**。

**缺口 B：脱敏（0.25 天，⭐ 面试必讲）**

goose 有专门的安全处理（`prompt_manager.rs:324` 有回归测试
`project_git_metadata_does_not_reach_system_prompt`）：
**`.git/config` 里可能存着 `oauth2:PROMPT_SECRET@github.com` 这种带凭据的 remote URL，
绝对不能进 system prompt。**

你的 `_loadBootstrapFiles()` 目前**没有任何脱敏**。要补：
- 复用 `src/agent/tools/redact.ts` 的脱敏逻辑
- 约定文件路径**必须在工作区内**（防 `../` 越界）
- **不读 `.git/` 目录下的任何文件**

**缺口 C：兼容更多约定文件名（0.25 天）**

现在只认 `AGENTS.md` / `SOUL.md` / `USER.md`。
可以顺手加 `CLAUDE.md`（Claude Code 生态）、`.cursor/rules/`（Cursor 生态）。
**加分项，不是必须。**

#### 实现落点

| 缺口 | 做什么 | 位置 |
|---|---|---|
| A | 子目录 AGENTS.md 懒加载（监听工具调用的 path） | 新建 `src/agent/hints/loader.ts` + 接 `operations/toolExecution.ts` |
| B | 脱敏 + 路径越界检查 | `context.ts` 的 `_loadBootstrapFiles()` |
| C | 多文件名兼容 | `context.ts:34` 的 `BOOTSTRAP_FILES` |

> ⚠️ **注入方式必须是"system prompt 之外的当轮注入"，不能写进消息历史。**
> 这是 nanobot 的 `RuntimeContextBlock` 模式
> （`nanobot/agent/runtime_context.py`）：每轮的运行时上下文**单独注入**，
> **不写进持久化的消息历史**。
> 为什么这很重要？——**因为消息历史会被压缩、会 replay、会存到 session 文件。**
> 把"当前目录的 AGENTS.md"写进历史，下次 replay 出来的对话就带着一个过期的约定。
> goose 也明确这么要求（`crates/goose/src/agents/prompt_manager.rs:287`
> 有个测试 `prompt_contributions_are_not_retained`）。

#### 验收标准

- [ ] 工作区根目录有 AGENTS.md 时，system prompt 里能搜到它的内容（**已实现，要补测试**）
- [ ] 子目录 AGENTS.md **在 agent 读了该目录文件之后**才被注入（不是一开始就全注入）
- [ ] 注入内容**不出现在 session 持久化文件里**（有单元测试断言）
- [ ] `.git/config` 里的带凭据 URL **不会**出现在 system prompt（有回归测试）
- [ ] ≥4 个单元测试

---

### 任务 10.3：作用域审批 —— "以后都允许"要绑定到具体命令（W2 后半，2 天）

**这是 coding agent 里最被低估的信任特性。**

#### 10.3.1 现状 vs 目标

| | 现在 | 目标 |
|---|---|---|
| 审批粒度 | 工具级（`run_shell` 要确认） | **命令级**（`git status` 免确认，`rm -rf` 要确认） |
| 记忆 | 无（每次都问） | 用户点"总是允许"→ **永久 + 可过期 + 可撤销** |
| 作用域 | — | **绑定到参数哈希**，不是绑定到工具名 |

#### 10.3.2 借鉴 goose 的 `permission_store.rs`

goose 的做法（`crates/goose/src/permission/permission_store.rs`）：
- `:12` `ToolPermissionRecord { tool_name, allowed, context_hash, readable_context, timestamp, expiry }`
- `:117` **`hash_tool_context()` = 对工具参数取哈希**
- `:63` **原子写**（先写 `.tmp` 再 rename）
- `:129` `cleanup_expired()` 加载时清理过期项

> **比喻（这个比喻面试时直接用）**：
> 现在的实现是"门禁卡 = 刷开整栋楼"。你要的是
> "**门禁卡 = 只对工位 3 号有效**"。
> 用户说"以后都允许"，指的其实是"以后都允许**这一类**命令"，
> 不是"以后都允许 `run_shell` 这个万能工具"——
> **这正是安全设计的核心区别。**

**但要抄 goose 的一个警告**：goose 用的是 **blake3 哈希**。
你**不要**直接用哈希（不可逆，用户看不懂自己批过什么）。
**你的版本应该存"可读的上下文"（goose 字段里就有 `readable_context`）**：
存 `"git status"`、`"npm test"` 这样的原文，让用户能在 UI 里看到"你批过这些"。

#### 10.3.3 存储设计

```jsonc
// context.globalStorageUri / approvals.json
{
  "version": 1,
  "entries": [
    {
      "tool": "run_shell",
      "contextHash": "sha256:...",      // 判定用
      "readable": "git status",          // 显示用
      "allowed": true,
      "createdAt": "2026-10-27T...",
      "expiresAt": "2026-11-26T..."      // TTL，默认 30 天
    }
  ]
}
```

**匹配规则（重要，别搞成"前缀匹配"）**：
- `run_shell` 的上下文 = **归一化后的命令**（去空格、统一引号、展开 `&&` 分段）
- **逐段匹配**：`git status && npm test` → 拆成两段，**两段都在白名单才放行**
  > 这是安全细节：只匹配整串的话，`git status; rm -rf /` 会被当成"不在白名单"（好），
  > 但如果做成"前缀匹配"就会漏。**逐段 + 精确匹配**最安全。

#### 10.3.4 UI（很轻，但很重要）

- 审批弹窗加两个按钮：**「允许一次」** / **「总是允许 `git status`」**
- 新增命令 `mini-coder.manageApprovals` → 列出所有白名单项，用户可以**逐条撤销**
- 状态栏显示"已授权 N 条规则"

> **为什么"可撤销"很关键**：授权是**累积**的。
> 用户三个月前批过的 `npm run xxx`，今天早就忘了。
> **一个只能加不能删的授权列表，是安全债务。**

#### 10.3.5 验收标准

- [ ] 审批弹窗能选"总是允许"，且只对**参数完全匹配**的命令生效
- [ ] `git status` 免确认，但 `git status; rm -rf /` **仍要确认**（有测试）
- [ ] 授权项有 TTL，过期后自动失效（有时间可控的测试）
- [ ] 有 UI 能列出并撤销所有授权
- [ ] ≥8 个单元测试（匹配规则是安全逻辑，必须测透）

---

### 任务 10.4：动态工具注册表的收尾（W3，1 天）

10.1 做完之后，MCP 工具是**运行时注册**的，这带来三个新问题必须收尾：

| 问题 | 现象 | 解法 |
|---|---|---|
| **工具数量膨胀** | 装了 5 个 MCP server → 30+ 工具 → system prompt 爆炸 | **工具分组 + 按需披露**：system prompt 只放内置 11 个工具的 schema；MCP 工具放"工具索引"（名字+一句话描述），模型要用时先调 `search_tools` 查详情 |
| **模型幻觉工具名** | 模型可能编一个不存在的工具名 | **模糊匹配 + 建议**（nanobot `registry.py:58-69` 的 `"Did you mean 'X'?"`） |
| **服务器中途挂了** | 之前广告过的工具突然没了 | **本轮已广告的工具即使服务器挂了也要补一条"执行失败"消息**（不能让 assistant/tool 配对断掉 → 400） |

> ⚠️ **第三条是协议级红线**。你已经有这个机制了
> （`toolExecution.ts:99-108` 的 `advertisedTools` 校验 + `historyRepair.ts` 的补齐），
> 但要**专门加一条 MCP 场景的测试**：
> "MCP 服务器在工具调用前崩溃 → 会话仍能继续，不会 400"。

> **比喻（工具分组）**：
> 现在的做法是"把 30 把钥匙全挂在钥匙板上，模型随便挑"。
> 更好的做法是"**钥匙柜上贴张目录**（哪个抽屉放哪类钥匙），
> 需要哪类就去抽屉拿具体的钥匙"。
> nanobot 的 `registry.get_definitions()` 把内置工具排在 MCP 工具前面
> （`registry.py:86-108`），也是同一个思路。

**验收标准**：
- [ ] 装 5 个 MCP server 后，system prompt 长度增长 < 30%
- [ ] 模型编造工具名时，返回带 "Did you mean" 的友好提示（不是崩溃）
- [ ] MCP server 崩溃场景的回归测试通过
- [ ] `npm run check` 检查工具名唯一性

---

## 三、Phase 11：深度工程化 —— 把"能跑"变成"能证明"（W4~W6，3 周）

> Phase 10 做完，你就是"一个功能完整的 agent 插件"了。
> Phase 11 做的是**别的候选人抄不走的东西**——**证据**。

### 任务 11.1：Recipe —— 把一次性提示词变成可版本化的工作流（W4，3 天）

**借鉴 goose 的 `crates/goose/src/recipe/mod.rs:43`**：

```rust
pub struct Recipe {
    pub version: String,
    pub title: String,
    pub description: String,
    pub instructions: Option<String>,   // :55
    pub prompt: Option<String>,           // :58
    pub extensions: Option<Vec<ExtensionConfig>>, // :65
    pub settings: Option<Settings>,       // :99  provider/model/temperature/max_turns
    pub activities: Option<Vec<String>>,  // :71  UI 上显示的"活动标签"
    pub parameters: Option<Vec<RecipeParameter>>, // :77  可填参数
    pub response: Option<Response>,       // :113 json_schema —— 结构化输出契约
    pub sub_recipes: Option<Vec<SubRecipe>>, // :120
    pub retry: Option<RetryConfig>,       // :86
}
```

**⭐ 关键洞察：goose 用 Recipe 来定义它自己的"自检流程"**——
`goose-self-test.yaml` 有 400+ 行，是一个**让 goose 自我验证的 recipe**，
成功标准写的是"Phase success: ≥80% tests pass"。

> **比喻**：recipe 就是**菜谱**。
> prompt 是"今天随便做点吃的"，recipe 是"宫保鸡丁：主料、辅料、火候、装盘标准、可替换参数"。
> 菜谱能**版本化**、能**给别人照着做**、能**评价做得好不好**。

**你的 Recipe 格式（YAML，目录 `recipes/`）**：

```yaml
# recipes/code-review.yaml
version: 1
title: 代码审查
description: 对当前改动做一轮带结构化产出的审查
parameters:
  - key: target
    input_type: text
    description: 要审查的文件或目录
    default: "src/"
  - key: strictness
    input_type: select
    options: [lenient, strict]
    default: strict
instructions: |
  审查 {{target}} 的改动，标准为 {{strictness}}。
  重点关注：协议合法性、权限边界、并发竞态。
response:
  json_schema:
    type: object
    properties:
      findings: { type: array, items: { type: string } }
      severity: { type: string, enum: [low, medium, high] }
    required: [findings, severity]
```

**三个用途（缺一不可）**：
1. **产品功能**：用户在面板里选一个 recipe → 填空 → 执行
2. **评测载体**：**你的 30 道评测题可以全部变成 recipe**，
   题目参数化 → **同一套 recipe 参数化后跑 30 次**
   （这解决"每道题要写一套 prompt"的重复）
3. **自我验证**：写一个 `recipes/self-test.yaml`，让 agent 跑一遍自己的回归测试

> **这是 goose 和 nanobot 都没有的东西**：
> nanobot 根本没有评测框架；goose 有 recipe 但没接到评测体系里。
> **你两边都有，把它们接起来，就是一个独特的东西。**

**验收标准**：
- [ ] `recipes/` 下有 ≥3 个 recipe（含参数和 JSON Schema 输出契约）
- [ ] 面板里能选 recipe、执行、看结构化结果
- [ ] **≥10 道评测题迁移到 recipe 格式**，评测 runner 走 recipe 路径
- [ ] recipe 有 schema 校验（YAML 写错要报错，不是静默忽略）

---

### 任务 11.2：record/replay 确定性回归（W5，3 天）

**这是 Phase 11 里技术含量最高、面试最加分的一项。**

**问题**：agent 行为天生不确定（温度、模型版本、工具顺序），
所以每次评测都要**花钱 + 花时间 + 结果还可能抖**。
这导致：CI 里跑不起完整评测、回归检测有噪声、"我这次改好了"无法判定。

**goose 的解法**（`crates/goose/tests/mcp_integration_test.rs` +
`crates/goose/tests/mcp_replays/*.results.json`，`GOOSE_RECORD_MCP=1` 重录）。

**你的三层录制**：

| 层 | 录什么 | 回放效果 | 用途 |
|---|---|---|---|
| **L1 provider** | LLM 的流式响应 | 确定性返回同样的 tool_calls | 测**管线逻辑**（分批、审批、协议修复、压缩） |
| **L2 工具** | 工具执行结果 | 确定性返回同样的输出 | 测**多轮编排**（第 2 轮、第 3 轮的行为） |
| **L3 MCP** | MCP server 响应 | 确定性返回同样的工具列表和结果 | 测**协议兼容性** |

**L1 怎么实现（这是关键设计）**：

你的 `OpenAIProvider.stream()` 是 `async *` 生成器。
做一个 `RecordedProvider implements 同样的接口`：
```typescript
class RecordedProvider {
  // 从 cassette 文件读，按顺序吐
  async *stream(messages, tools, signal) {
    const rec = this.cassette.next();   // 按调用序号取
    // 按原样 yield 录下来的 chunk
  }
}
```
- **录制模式**：`REAL` 环境变量下走真 provider，同时把每次响应写进 cassette
- **回放模式**：读 cassette
- **匹配键**：`messages.length + tools.length + 末条 user 消息的 hash`
  （不能只看序号——改了代码后轮次会变，序号匹配会全错位）

> **比喻**：这就是"**彩排**"。
> 第一次演出（录制）用真演员（真 LLM），之后每次彩排（回放）用录像。
> **演出效果完全一致，但成本为零、可以随时排练。**

**带来的三个能力**：
1. **CI 能跑完整 30 题了**（回放模式，零成本零网络）—— 现在 CI 只跑 2 题冒烟
2. **回归检测变确定** —— 每次改动后跑回放，结果差异就是**真实的行为差异**，不是噪声
3. **可以写"幂等性"测试** —— 同一输入跑 10 次，行为必须完全一致

**验收标准**：
- [ ] `npm run eval:replay` 用回放模式跑完 30 题，结果与录制时**完全一致**
- [ ] CI 里加一个 job 跑回放模式（零成本）
- [ ] cassette 文件进 git，且有"录制/回放"切换开关
- [ ] ≥3 个"确定性回归"测试（改坏代码 → 回放测试变红）

---

### 任务 11.3：评测集恢复刻度（W5~W6，3 天）

**如果 9.2 跑完 30 题还是 100%，这一项就变成最高优先级。**

**参考三种让尺子重新有刻度的手段**：

| 手段 | 来源 | 做法 | 成本 |
|---|---|---|---|
| **对抗题** | 你自己已有（21-27、35、47） | 加"专门让 agent 失败"的题 | 低 |
| **规模题** | 你自己已有（41-44） | 加"50+ 文件的合成代码库"题 | 中 |
| **LLM-judge** | goose `scripts/bench-postprocess-scripts/llm_judge.py` | 用 LLM 给**过程质量**打分（不只看结果对不对，还看"过程是不是乱搞"） | 中 |
| **自我验证 recipe** | goose `goose-self-test.yaml` | 让 agent 跑自己的回归测试 | 低 |

**我建议的三步**：

**① 加"过程质量"指标（不是只看 pass/fail）**

现在的指标是二元的（case 通过/不通过）。
加一个**过程分**：
- **工具调用轮数**（已记录）
- **重复调用率**（已记录，`repeatGuard` 在拦）
- **token 消耗**（已记录）
- **LLM-judge 打分**：这一步做得好不好？有没有乱改不该改的文件？

> **比喻**：现在的评测像**驾照考试**——只看"过没过"。
> 好的评测像**实际驾驶评估**——过是必须的，
> 但还要看"开得稳不稳、有没有急刹、有没有压线"。
> **两个都测，你才能说"我的 agent 变好了"，而不只是"我的 agent 还能用"。**

**② 合成代码库生成器**

ROADMAP_V2:1164 自己提过：
> *"用脚本生成合成代码库（几十个相似的模块 + 散落的调用点），比手写省事"*

**这个脚本至今没做**，而它正是"规模题"的弹药库。
写一个 `scripts/genScaleRepo.ts`：
```
参数：模块数、每个模块的行数、调用点分布、故意埋的陷阱类型
输出：一个可复现的合成代码库 + 一组 oracle
```
> **为什么可复现很重要**：用**固定随机种子**，
> 这样"第 37 题"每次生成的代码库**完全一样**，
> 别人 clone 你的仓库能跑出跟你一样的结果。
> **这叫"可复现的评测"——是评测可信度的地基。**

**③ 目标值（这是关键）**

| 指标 | 当前 | 目标 | 为什么 |
|---|---|---|---|
| 30 题 pass rate | 100%（23 题实测） | **75~90%** | 全对说明题太水。有区分度才能当尺子 |
| case 级修好率 | 100% | 70~90% | 同上 |
| 重复调用率 | 9 题有 ≥5 次重复 | **≤2 题** | 成本大头，也是 agent 变笨的信号 |
| 单题平均成本 | ¥0.143 | **≤¥0.12** | 降本本身就是一个可写进简历的指标 |

> ⚠️ **注意**：pass rate 从 100% 降到 85% **不是变差了，是尺子活了**。
> ROADMAP_V2 的比喻在这里依然准确：
> *"体温计量不出发烧了——不是没病，是尺子坏了。"*
> **面试时这句话要主动讲**，因为大部分候选人的项目都是 100%，他们不懂为什么。

---

### 任务 11.4：Dogfooding —— 用自己的产品改自己的项目（W6，2 天）

**你已经有一个 commit 叫 `feat(audit): 支持在真实项目上动手改造`**——
这是个很好的种子，但**没有公开证据**。

**做法（这是最有说服力的一步）**：

1. 挑一个**真实的中型开源项目**（不是自己的项目，是别人的）
   —— 比如 `D:\AI agent\nanobot-main` 的某个模块，或者一个 5~20 万行的 TS 项目
2. 用 mini-coder 做一个**有明确验收标准**的改造任务
   - 例如："把 nanobot 的 `runner.py` 的工具执行逻辑补上 JSDoc，
     不改任何行为，测试必须全绿"
3. **全程记录**：调用链（`/traces` 已有）、耗时、token、最终 diff
4. 写一篇**复盘文章**（放仓库 `docs/DOGFOODING.md`，也是博客素材）

> **比喻**：你造了一台车，开到赛道上去跑了一圈，
> 记下了圈速、刹车距离、换了什么胎。
> **这份"赛道报告"比任何参数表都有说服力**——
> 因为它证明这车真的能跑，不是停在车库里的模型车。

**对面试的作用**：
- "我用自己写的 agent 改造了一个 20 万行的真实项目，改了 37 个文件，
  全部测试通过，我分析了它失败的 3 次并修了 2 个 bug" ← **这句话的分量**
- 比"我实现了一个 ReAct Agent 循环"强 10 倍
- 因为前者证明了**闭环**（agent → 真实代码 → 验证 → 修 agent 本身）

**这形成了一个飞轮**：
```
真实项目 → agent 改造 → 发现 agent 的缺陷 → 修 agent → 评测集加题 → 尺子更准
     ↑                                                        │
     └────────────────────────────────────────────────────────┘
```

**验收标准**：
- [ ] `docs/DOGFOODING.md` 存在，含：项目规模、任务描述、diff 规模、
      失败次数、失败原因分析、修复后的复测结果
- [ ] 至少 2 个失败案例被分析并转化为评测题
- [ ] 这些新题加进 eval/tasks（**尺子因为真实失败而变准** —— 这是最有说服力的加题理由）

---

### 任务 11.5：真实用户与分发（W6，并行）

| 渠道 | 动作 | 价值 |
|---|---|---|
| **VS Code Marketplace** | 申请 publisher token → `vsce publish` | **可安装的链接**。简历写"已发布到 Marketplace"比"我做了个插件"强一个量级 |
| **GitHub Release** | 每次发版都发（Phase 9.4 开始） | 覆盖所有人 |
| **中文技术社区** | 掘金 / CSDN / V2EX 发 2 篇技术文章 | 曝光量最大的地方 |
| **同校/同学** | 让 5~10 个人真的用起来，收集反馈 | **产品反馈比任何测试都真实** |
| **GitHub Issues** | 认真回复每一个 issue | 面试官会去看 issue 区，**那里全是真实用户的对话** |

> **为什么第 4 条最重要**：面试官问"有真实用户吗"，你说"有 10 个人用过，
> 他们提了 7 个问题，我修了 5 个"——**这句话没有任何 demo 能替代。**
> 而且它还会**反过来产出评测题**（每个用户报的 bug 都是一道对抗题）。

> ⚠️ **关于 Marketplace**：需要微软账号 + publisher PAT，流程有一次性成本，
> 建议放在 W6 而不是 W0。但**值得做**——它把"我写了个插件"变成"我发布了一个产品"。

---

## 四、时间线总表

| 周 | 阶段 | 产出物 | 验收（可勾选） |
|---|---|---|---|
| **W0** | **Phase 9 止血** | 21 提交推送、CI 修复、30 题评测、数字校正、v0.4.0 Release、AGENTS.md | ⭐ **CI 徽章是绿的、Release 能点开、README 数字全部对得上** |
| **W1** | **Phase 10.1 MCP** | `src/agent/mcp/` 4 个文件、stdio 客户端、schema 归一化、5 个测试 | 能连真实 MCP server 并调用成功 |
| **W2** | 10.2 项目约定子目录懒加载 + 脱敏 + 10.3 作用域审批 | `src/agent/hints/`、审批存储 + UI | "总是允许"只对匹配命令生效 |
| **W3** | 10.4 动态工具收尾 | 工具分组、`search_tools`、MCP 崩溃回归测试 | 5 个 server 装上后 prompt 只涨 30% |
| **W4** | 11.1 Recipe | `recipes/` 3+ 个、10 道题迁移 | 面板能跑 recipe、评测走 recipe 路径 |
| **W5** | 11.2 record/replay | cassette 录制器 + 回放器 | CI 跑完整 30 题（零成本） |
| **W6** | 11.3 评测刻度 + 11.4 Dogfooding + 11.5 分发 | 合成代码库生成器、LLM-judge、DOGFOODING.md、Marketplace | **pass rate 落到 75~90%**、有真实用户反馈 |

**总投入估算**：W0 约 1~2 天；W1~W3 约 15 天；W4~W6 约 15 天。
按"在校生 + 兼顾课业"每周 15~20 小时算，**6 周可完成**。

---

## 五、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| **推送后 CI 一直红** | 中 | 高 | 先本地 `npm test` + `npm run check` + `npm run compile` 三连；eval-smoke 只跑 2 题（¥0.11）；覆盖率阈值设成"当前实测值 − 3" |
| **MCP 客户端写太久（拖成 2 周）** | **高** | 中 | **严格只做 stdio**。一旦想加 HTTP/OAuth，立刻停下——那是 nanobot 2500 行的路 |
| **MCP server 起不来 / 各种平台差异（Windows 尤其）** | 高 | 中 | Windows 的 `npx` 路径、stdio 换行符、GBK 编码问题你**已经踩过**（`runShell.ts` 有经验），复用那些处理；提供"手动填可执行文件绝对路径"的兜底配置 |
| **评测跑完还是 100%，做不出刻度** | 中 | 高 | 优先级立刻切到"规模题 + 对抗题"；实在不行就**下调难度档位**（把简单题改难），别硬凑 |
| **scope 审批被绕过** | 低 | **极高** | 白名单匹配**必须逐段精确匹配**，不能前缀匹配；`.git`、`rm`、`curl` 这类命令**永远不给白名单**（硬编码黑名单优先） |
| **课业冲突断更** | 高 | 中 | **每个任务拆到"当天能做完"**；提交粒度比任务粒度更重要；断了就跳过当前任务，不要硬啃 |
| **API 成本超支** | 低 | 低 | 一轮全量 eval ≈ ¥3.9；日常只跑子集；CI 只跑 2 题冒烟；**record/replay 上线后大部分回归测试免费** |
| **加了 MCP 之后架构腐化** | 中 | 中 | 把 MCP 做成**独立子目录 + 独立注册表**（nanobot 的 `agent/tools/mcp.py` 就是这么隔离的）；加架构守卫禁止 `src/agent/mcp/` 直接 import `src/webview/` |
| **简历数字再次对不上** | 中 | 中 | 加一个 CI job 跑 `scripts/checkProject.js` 的**数字校验**（见 11.6） |

### 11.6 ⭐ 建议追加：把"数字自检"也做成 CI job（30 分钟，性价比极高）

**这个项目最大的特色是"每条数字都能复现"，那就让机器帮你盯着。**

在 `scripts/checkProject.js` 里加一个 `numbers` 检查项：
- 实测 src 行数、测试行数、工具数量、slash command 数量、评测题数量
- 和 `README.md` / `ARCHITECTURE.md` / `docs/RESUME.md` 里写的数字**比对**
- 对不上就 **CI 变红**

> **比喻**：你家墙上挂了个"我家三口人"的牌子，
> 现在家里四个人了但牌子没换——面试官一数就露馅。
> **让 CI 当那个每次数一遍的人。**

**验收标准**：
- [ ] `npm run check` 会校验文档里的数字
- [ ] 故意改 README 里的一个数字 → `npm run check` 报错
- [ ] CI 里跑 `npm run check`（现在已经在跑了，加这一项即可）

---

## 六、简历和面试怎么讲（Phase 9~11 做完后的口径）

### 6.1 简历条目（每条都有数字和链接，链接全部可点开验证）

> **AI 编程助手（VS Code 插件，TypeScript）** ｜ 个人项目 ｜ [GitHub](链接) ｜ [Marketplace](链接) ｜ [评测报告](链接)
>
> - **Agent 运行时**：ReAct 循环管线化（11 个 Operation 单一职责），11 个工具按
>   "只读并行 / 写串行"分批执行；实现上下文双可见性（压缩不删历史，仅打
>   `agentVisible` 标记，用户可回看）与协议层自愈（孤儿 tool_call 自动补齐，
>   规避 OpenAI 兼容协议的永久 400）。
> - **MCP 客户端**：实现 stdio 传输的 MCP 客户端（JSON-RPC 2.0），
>   支持动态工具注册、schema 归一化（`$ref` 内联 / nullable 转换）、
>   服务器故障降级；MCP 工具按命名空间隔离并纳入不可信数据边界。
> - **评测体系**：自研 30 题三档难度回归检测集（baseline→after 三方比对，
>   识别"改对目标、弄坏别处"），配套消融实验（摘除工具反推能力来源）、
>   方差统计与显著性判定、record/replay 确定性回归（CI 零成本跑全量）。
> - **工程化**：529 个单元测试全绿，GitHub Actions 双平台矩阵 CI，
>   自研架构守卫（工具名同步 / 迭代上限单一真相源 / 密钥扫描 / 文档数字自检），
>   已发布 VS Code Marketplace。

### 6.2 面试新增 4 问（现有 `docs/INTERVIEW.md` 12 问之外）

**问 1：为什么你的项目放弃了 goose 的 LLM-as-judge 权限判定？**
> 现有 `docs/INTERVIEW.md` 已有这题，**继续讲**。核心三点：慢、烧钱、判不准。
> **再补一层**：goose 自己也承认这条路有问题——所以它后来加了
> `permission_judge.rs` 和 `permission_inspector.rs` 两个文件做补充，
> 说明**纯静态元数据也不够**。你的答案是"静态元数据 + 作用域化白名单"，
> 正好站在两者中间。

**问 2：为什么你的工具可以并行执行，而 goose 不行？**
> **这题现在答不上来，因为你的代码比 goose 好，但面试官不知道。**
> 答：goose 的核心循环是严格串行的（`crates/goose-agent/src/tool.rs:362`
> 是一个 `for ... await`），它把并行放在扩展启动和同消息多 delegate 上。
> 我按"有没有副作用"分批：只读并行（`Promise.all` 保证顺序 === 传入顺序，
> 这是协议合法性的前提），写操作严格串行——因为两个 patch 改同一文件会互相覆盖，
> 两个审批弹窗会同时弹给用户。

**问 3：你的评测集 pass rate 是 85%，是不是能力不行？**
> **这题现在不存在（你是 100%），做完 Phase 11 它会出现。**
> 提前准备好的答案：
> "评测集刚扩完是 100%，那说明**尺子坏了不是人坏了**——体温计量不出发烧了。
> 所以我做了三件事：加对抗题、加规模题、加过程质量指标（LLM-judge 打过程分）。
> 目标是把 pass rate 落到 75~90%，让它有区分度。
> **因为一个永远 100% 的评测集，证明不了任何优化。**"

**问 4：MCP 客户端里最难的部分是什么？**
> 答 schema 归一化。
> MCP 的 `inputSchema` 是完整 JSON Schema，能带 `$ref` / `$defs` / `oneOf`，
> 但很多 OpenAI 兼容后端只认扁平 schema。
> **模型拿到一份后端不认的 schema，轻则调用失败，重则幻觉出错误参数。**
> 我处理了 `$ref` 内联展开、`type: ["string","null"]` → `nullable`、
> `oneOf` 降级 `anyOf` 四类。
> 参考 nanobot 的 `agent/tools/mcp.py:395-507`——它花了 2500 行，
> 我只需要 120 行，因为我不做 HTTP/OAuth/SSRF。

### 6.3 三个"哇"点（面试官会记住的）

| 哇点 | 一句话版本 |
|---|---|
| **拒绝 LLM-as-judge** | "工业界用 LLM 判断权限，我研究后主动放弃了——慢、烧钱、而且**判权限这件事本身就能被注入攻击**。" |
| **双可见性** | "压缩上下文时不删历史，只打标记。用户能回看 agent 当时到底看到了什么。压缩因此是**可逆**的。" |
| **静态元数据 + 作用域白名单** | "我不让 LLM 判断危险不危险。我让**用户的每一次授权都绑定到具体命令**，并且可过期、可撤销。" |

---

## 七、更新版"不要做"清单（省下 2 个月）

| 项 | 判断 | 理由 |
|---|---|---|
| ~~MCP 接入~~ | ✅ **改成"做，但只做 stdio"** | 见任务 9.6。它是 2026 年 agent 岗的入场券 |
| **HTTP / SSE / OAuth 传输的 MCP** | ❌ 不做 | nanobot 那 2500 行里一半是这块。stdio 覆盖 90% 真实需求 |
| **MCP 沙箱 / 容器隔离** | ❌ 不做 | 你的插件跑在用户自己的机器上，和 nanobot（服务器）信任边界完全不同 |
| **LLM-as-judge 权限判定** | ❌ **继续不做** | 你已经正确拒绝了，别改回去 |
| **完整 Provider 矩阵** | ❌ 不做 | 4 个主流够用。加 Provider 只改 `PROVIDER_CONFIGS` 一张表（你已经做到了） |
| **Op 化状态机的完全版** | ❌ 不做 | 你已经做了"够用的管线化"，别去追 goose 的 Effect 落盘 + 每步重载会话 |
| **把项目搬成 TypeScript 全栈 Web 服务** | ❌ 不做 | 那是另一个项目，会稀释这 6 周的成果 |
| **同时投多个岗位方向** | ❌ 不做 | 这个项目是 **agent 应用岗**的敲门砖，投算法岗它是减分项 |
| **向量库 / RAG / embedding** | ❌ 不做 | 这是 wxu 项目的地盘。两个项目都做 = 两个都不深 |
| **多智能体协作框架（agent 互相通信）** | ❌ 不做 | 你已经有 delegate（子智能体上下文隔离），这是 agent 岗问的"多步任务状态管理"。再往上就是研究课题，不是校招项目 |
| **前端重写 / UI 大改** | ❌ 不做 | webview 995 行，够用。UI 不是这个岗位的考点 |

---

## 八、附录 A：关键文件索引

### 要改的文件

| 文件 | 动作 | 阶段 |
|---|---|---|
| `.github/workflows/ci.yml` | `branches: [main]` → `[master]`；加"文档数字自检"job | 9.1 / 11.6 |
| `README.md` | 工具数 9→11；评测题 23→30；加 MCP 章节；加 badge | 9.2 / 9.3 / 10.1 |
| `ARCHITECTURE.md` | 测试行数、webview 行数校正；加"动态工具"架构图 | 9.3 / 10.4 |
| `docs/RESUME.md` | 全部数字随实测更新；加 MCP / recipe / record-replay 条目 | 每阶段末 |
| `docs/INTERVIEW.md` | 加 4 题（见 6.2） | Phase 11 末 |
| `scripts/checkProject.js` | 加"文档数字自检"检查项；加 MCP 工具命名空间检查 | 11.6 / 10.4 |
| `package.json` | 加 `eval:replay` / `recipe` 相关脚本 | 11.1 / 11.2 |
| `src/agent/context.ts` | 注入 AGENTS.md 约定（不污染历史） | 10.2 |
| `src/agent/tools/registry.ts` | 支持运行时注册 + 工具分组 + 模糊匹配建议 | 10.4 |
| `src/agent/tools/approval.ts` | 接作用域白名单判定 | 10.3 |
| `src/agent/operations/toolExecution.ts` | MCP 工具走不可信边界；MCP 崩溃补消息 | 10.1 / 10.4 |

### 要新增的文件

| 文件 | 行数估 | 干什么 | 阶段 |
|---|---|---|---|
| `AGENTS.md` | 150 | 项目纪律（给 AI 看的说明书） | 9.5 |
| `.vscode/mini-coder-mcp.json`（示例） | 40 | MCP 配置示例 | 10.1 |
| `src/agent/mcp/protocol.ts` | 150 | JSON-RPC 2.0 类型 + 编解码 | 10.1 |
| `src/agent/mcp/stdioClient.ts` | 250 | 子进程 + 请求配对 + 超时 | 10.1 |
| `src/agent/mcp/manager.ts` | 200 | 多服务器管理 + 注册表同步 | 10.1 |
| `src/agent/mcp/schemaNormalize.ts` | 120 | MCP schema → OpenAI 归一化 | 10.1 |
| `src/agent/hints/loader.ts` | 200 | 子目录 AGENTS.md 懒加载（根目录已实现） | 10.2 |
| `src/agent/approvals/store.ts` | 180 | 作用域白名单（哈希 + 可读文本 + TTL） | 10.3 |
| `src/agent/recipes/` | 3 个文件 | Recipe 类型 + 加载器 + 校验 | 11.1 |
| `src/eval/replay/` | 250 | cassette 录制器 + 回放器 | 11.2 |
| `scripts/genScaleRepo.ts` | 250 | 合成代码库生成器（固定种子） | 11.3 |
| `recipes/*.yaml` | 3+ 个 | 工作流定义 | 11.1 |
| `docs/DOGFOODING.md` | 300 | 真实项目改造复盘 | 11.4 |

### 参考项目里要读的（精确位置）

| 项目 | 文件:行 | 看什么 |
|---|---|---|
| **goose** | `crates/goose-agent/src/tool.rs:119-122` | 工具名在广告→处理完之间必须稳定的铁律（**你已有等价实现**） |
| **goose** | `crates/goose-agent/src/machine.rs:145-154` | 每个 operation 都能往 inference 贡献工具和 prompt 片段 |
| **goose** | `crates/goose/src/permission/permission_store.rs:12,63,117,129` | 作用域授权：参数哈希 + 原子写 + TTL 清理 |
| **goose** | `crates/goose/src/hints/load_hints.rs:10-11,42,87,128` | AGENTS.md 懒加载（按工具调用的 path 触发） |
| **goose** | `crates/goose/src/agents/prompt_manager.rs:287,324` | prompt 贡献不持久化；`.git/config` 不进 prompt 的回归测试 |
| **goose** | `crates/goose/src/agents/extension_manager/mod.rs:130-144` | MCP 工具缓存的 session scope + 版本号 |
| **goose** | `crates/goose/src/recipe/mod.rs:43-120` | Recipe 完整字段 |
| **goose** | `goose-self-test.yaml` | 让 agent 自我验证的 recipe（400+ 行） |
| **goose** | `crates/goose/tests/mcp_integration_test.rs` + `mcp_replays/` | **record/replay 测试模式** |
| **goose** | `crates/goose/src/agents/large_response_handler.rs:5,68` | 大输出外置阈值（你已有 `toolOutputStore.ts`） |
| **goose** | `crates/goose/src/agents/prompt_manager.rs:188-190` | 时间戳截断到小时 + 稳定工具排序（**为了 prompt cache 命中**） |
| **goose** | `crates/goose/src/agents/prompt_manager.rs:123,144,173` | 隐藏 Unicode 标签清洗（提示注入防线，**你缺这个**） |
| **nanobot** | `nanobot/agent/tools/mcp.py:395-507` | **schema 归一化（`$ref` / nullable / oneOf）** |
| **nanobot** | `nanobot/agent/tools/mcp.py:245-312` | SSRF 防护 + HTTP 探测（stdio 路径用不到，但值得读） |
| **nanobot** | `nanobot/agent/tools/registry.py:58-69,86-108` | "Did you mean" 建议 + 稳定排序 |
| **nanobot** | `nanobot/agent/tools/execution.py:23-47,245-292` | 可恢复的工具错误分类 + 安全边界不可绕过 |
| **nanobot** | `nanobot/agent/runtime_context.py` | **runtime context 不污染历史** |
| **nanobot** | `nanobot/agent/subagent.py:278-282,347-359` | 子智能体资源硬上限 + 所有权校验 |
| **nanobot** | `nanobot/agent/llm_usage/types.py:37-78` | token 用量的不变量断言（`total >= in + out`） |
| **nanobot** | `scripts/check_import_boundaries.py:53-122` | **AST 级 import 边界守卫**（可抄进 checkProject.js） |
| **nanobot** | `.agent/design.md` / `security.md` / `gotchas.md` | `**Rule:**` 格式的操作纪律文档（9.5 的模板） |
| **nanobot** | `nanobot/llm_usage/store.py` + `llm_usage/context.py` | 持久化用量台账（按来源归因） |

---

## 附录 B：一句话总结

> **你的项目从来不是"功能不够"——529 个测试、11 个工具、11 个 Operation、
> 自研评测 + 消融 + 方差统计，这些内功已经超过 goose 和 nanobot 里的任何一个。**
>
> **它的问题是"造好了但没交出去"：**
> **21 个提交没推、CI 因为分支名写错从未跑过、0 个 Release、
> GitHub topic 写着 mcp 而代码里没有 MCP、README 数字前后打架。**
>
> **接下来 6 周就两件事：**
> **① W0 的一天半，把该亮的全亮起来**（推、修 CI、重跑评测、校正数字、发 Release、写 AGENTS.md）；
> **② 剩下的时间补上 MCP 这张入场券**，再用 Recipe + record/replay + dogfooding
> **造出别的候选人抄不走的证据。**
>
> **做完之后，简历上那行字是：**
>
> **"我实现了一个接入 MCP 生态的 VS Code Agent 运行时，
> 并为它建了一套带回归检测、消融实验和确定性回放的评测基线——
> 证明我的每一项优化既降了成本，又没弄坏别处。"**
>
> **这一行，95% 的候选人写不出来。**

---

*生成时间：2026-10-27 ｜ 所有数字均为当日实测 ｜ 未修改任何源代码*
