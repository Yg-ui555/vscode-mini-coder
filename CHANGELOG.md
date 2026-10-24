# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [0.3.1] — 2026-10-25

**真实项目验证：用插件审一个真的中型项目，当场暴露并修掉 3 个 bug**

评测集里的 23 道题都是小沙箱（5-9 个文件），只能回答「agent 在小项目上能不能改对」，
回答不了「这插件在**真实项目**上还顶不顶得住」。这一版补上这个缺口。

### 新增

- **`npm run audit -- <路径>`**（`scripts/auditProject.js`）：把**同一套 AgentLoop + 同一套工具**
  指向任意真实项目跑一遍体检。默认给**严格只读**的工具集
  （read_file / grep / glob / list_dir），全程不碰用户项目一个字。
  产出 Markdown 报告 + JSON 原始数据（含工具调用轨迹、token、成本、扫描预算诊断）。
- **扫描预算诊断**：跑之前先用插件自己的文件扫描器扫一遍，直接报告
  「扫到多少文件 / 有没有被截断 / 哪个目录吃光了配额」——
  这是本地诊断，不花一分钱。
- **prompt 跟着实际工具集走**（`ContextBuilder` 新增第三个构造参数 `toolNames`）：
  system prompt 里教 LLM 用哪个工具，现在由实际注册的工具决定。

### 修复

- ⭐⭐⭐ **agent 能把 `.env` 里的真实 API Key 原样读出来**
  （新增 `src/agent/tools/redact.ts`）：拿插件审一个真实项目时，
  agent 读了 `.env`，把里面的真实 API Key（`sk-xxx`）**原样写进了体检报告**。
  报告是要转发给人的 —— 密钥一旦进了报告就是泄露。
  而且这跟插件自己的价值观矛盾：prompt 快照测试里有「绝不能出现 API Key」的硬断言，
  但那管的是 system prompt，**管不到工具读回来的内容**。
  新增脱敏层，接在**三个出口**：`read_file` / `grep` / `run_shell`。
  设计取舍：**脱敏而不是拒绝读取** —— agent 经常需要知道「这个项目配了哪些环境变量」，
  硬拦截会让这类任务做不了。变量名 / URL / 布尔开关原样保留，
  只有密钥值被涂成 `***REDACTED***``，并附一句「这是安全策略，不是文件本来就这样」
  （不加这句，agent 会误判「这个 key 没配」）。
  覆盖：字面量密钥格式（`sk-` / `AIza` / `AKIA` / `ghp_` / `xoxb-` / 私钥整块）
  + 敏感文件里的 `KEY=xxx` 形式（`.env` / `*.pem` / `credentials.json` …）。
  ⚠️ 脱敏是**减少泄露面**，不是保证不泄露 —— 真正的防线仍是不把密钥提交进版本库。
- ⭐⭐⭐ **`IGNORED_DIRS` 精确匹配，拦不住带版本号的虚拟环境**
  （`src/agent/tools/fileScan.ts`）：拿插件审一个真实 Python 项目时，
  `venv_old` 一个目录就占了 **19992 个文件（99.96%）**，
  把 20000 的扫描上限吃光 —— **真正的项目代码一个都没扫到**。
  新增 `isIgnoredDirName()`：精确名单 + 模式匹配
  （`venv*` / `.venv*` / `env` / `site-packages` / `__pypackages__` / `eggs` /
  `.tox` / `.nox` / `target` / `vendor`）。
  ⚠️ 模式不能太宽：`environment` / `envs` / `targets` 这类正常项目目录不能误伤。
  **修复后：扫到 1864 个文件（完整）、耗时 406ms → 138ms、agent 能看见的项目代码 0 → 131 个。**
- ⭐⭐ **system prompt 无条件教 LLM 用 `record_note`**
  （`src/agent/context.ts`）：只读模式下 agent 会去调一个不存在的工具，
  白烧一轮 LLM 调用。
  更严重的是它让**消融实验的结论不成立** ——
  消融的前提是「LLM 连有这个工具都不知道」，
  但 prompt 里原本写着 record_note 的用法，**那次消融是漏的**。
  现在 prompt 按实际注册的工具裁剪（能力总述 / 核心约定 / 错题本段 / 工作流步骤全部条件化）。
- **`listDir` 的忽略判断**同样换成 `isIgnoredDirName()`（原先也是精确匹配）。

### 文档修正（诚实记录）

- **`eval/ABLATION.md` 与 `factory.ts` 注释**：原文写「摘掉的工具 LLM 连有都不知道 ——
  这才是干净的消融」。**对 `record_note` 并不成立**（prompt 里无条件教过）。
  已补充说明并指向本次修复；其余工具（grep / run_shell / glob …）
  prompt 里本来就没提名字，三组消融结论**不受影响**。

### 验证

- 测试 **451 → 474 个用例 / 30 个文件全绿**
  （新增 23 例守卫：5 例忽略规则 + 5 例 prompt 一致性 + 13 例脱敏规则）
- `tsc --noEmit` 0 错误
- 真实项目实测（修复后）：20 轮 / 52 次工具调用 / 84.3s / 541,662 token / ¥1.14
  —— 相比修复前**轮数 −26%、token −46%、成本 −50%**，而体检结论质量不降
- 脱敏实测：真实 `.env` 里 1 个 `sk-` 密钥 → 脱敏后 **0 个**，
  且 `LLM_BASE_URL` / `LLM_MODEL` / `USE_LANGGRAPH_AGENT` **零误伤**

---

## [0.3.0] — 2026-10-25

**Phase 2：Hook 机制（4 个生命周期点）+ 评测集扩容到 23 题 + 消融实验**

这一轮解决两个问题：
**①「自动跑测试」只能做一件事 → 升级成可扩展的 hook 机制；
②评测集 pass rate 已经 100% 饱和 → 补 5 道真难题 + 引入更细的信号。**

### 新增

- **Hook 机制**（`src/agent/hooks/`）：4 个生命周期点 —— `PreToolUse`（可否决工具调用）、
  `PostToolUse`（通知）、`Stop`（**测试没过就不许收工**）、`UserPromptSubmit`（注入上下文）。
  声明式配置（工作区 `.vscode/mini-coder-hooks.json`），子进程执行，stdin 传 JSON 上下文。
  借鉴 goose 的 `hooks/mod.rs`（12 个点取其中最有价值的 4 个）。
- **内置 Stop hook**：设置项 `mini-coder.hooks.stopAutoTest` 开启，
  复用 `autoTest` 的测试执行逻辑 —— agent 说"我做完了"时先跑一遍项目测试，
  没过就把它打回去继续干（连续 8 次强制放行，防死循环烧钱）。
- **5 道新题**（18 → 23）：`31-hard-real-tsc-build`（真跑 `tsc --noEmit`）、
  `32-hard-long-chain-migration`（5 个调用点 / 4 种调用形状 / 藏在 re-export 后面）、
  `33-hard-cross-module-contract`（内部契约变、对外契约不许变）、
  `34-hard-perf-keep-behavior`（check.js 内冻结原始实现做 16 组差分对拍）、
  `35-adversarial-silent-api-break`（加新功能时改坏上游依赖的"不抛异常"契约）。
  每题都配了标准答案（`eval/oracles/`），证明题目**有解**。
- **工具消融实验**（`npm run eval -- --ablate grep`）：把指定工具从注册表里摘掉
  （LLM 连它存在都不知道），用来回答"这道题到底在测什么"。
- **case 级「目标 case 修好率」**：任务级 pass rate 只有 0/1 两档，极易饱和 ——
  修好 1 个 case 和修好 15 个 case 都是 100%。新增指标把分母换成
  "baseline 挂掉的 case 数"，细一档的信号。
- `/doctor` 新增「Hook 机制」状态项：配置在哪、几个事件点、配置有没有语法问题。

### 修复

- ⭐⭐ **评测沙箱里错题本会污染 L4 回归检测**（`src/eval/runner.ts` + `src/util/notesStore.ts`）
  —— agent 调 `record_note` 会在工作区下造出 `.notes/` 目录，
  而 `listFiles()` 不忽略任何目录 → 被算成"agent 改了哪些文件"。
  理由和当初关掉 checkpoint **完全一样**，但当时漏了它。
  实测后果：26 号对抗题的"仓库文件集合不许变"守卫被 agent 的一条错题本干掉，
  而任务级判定还显示"通过"（那条守卫在 baseline 也是挂的，失败原因被掩盖）——
  **一次真实的越界行为差点从报告里消失**。
  现在评测把错题本写到**沙箱外**的临时目录，跑完删掉。
- `eval/tasks/26-*/check.js`：
  ① 文件集合断言改用共享的 `listFiles()`（自动忽略 `.notes/` `.mini-coder/` 簿记目录，
  和 18/27 号题统一口径）；
  ② 把"文件集合没变"和"demo 输出正确"**从捆在一起拆成两条** ——
  捆在一起会让其中一条的失败掩盖另一条，框架就分不清"修好了"和"弄坏了"。
- `src/agent/hooks/manager.ts`：内置 Stop 检查阻断时**提前 return**，
  绕过了"连续阻断上限"的计数 → 内置 hook 能无限打回，上限形同虚设。
- `src/agent/hooks/runner.ts`：Windows 的 `cmd.exe` 报错是 **GBK 编码**的，
  Node 按 UTF-8 解码出来是乱码，靠文本匹配**根本认不出"命令不存在"**
  （实测：正则永远匹配不上）。改为主动探测可执行文件是否存在
  （Windows `where` / POSIX `command -v`），且探测只在失败时才做。
- `src/eval/report.ts` / `src/agent/providerFallback.ts` / `src/eval/statistics.ts`：
  三处历史遗留的乱码字符。
- `eval/tasks/35-*/check.js`：`loadMod` 清 require 缓存后，被测模块和它依赖的模块
  会变成两个不同实例，基于计数/共享状态的断言读到 0。改为"先加载被依赖模块"。

### 实测

- **全量 23 题**：Pass Rate 100%（23/23），**0 回归**，目标 case 修好率见
  [`eval/RESULTS.md`](eval/RESULTS.md)
- 5 道新题单独跑：**28/28 目标 case 修好，0 回归**（逐 case 明细见报告）
  —— 题目不是送分题，但当前 agent 也确实够强。
- 新题单题均摊成本 ¥0.31，是老题均值（¥0.14）的 2.2 倍 —— 区分度从 pass rate
  转移到了**轮数 / 成本**维度。
- **消融实验**（`eval/ABLATION.md`）：三组配置（全量 / 摘 grep / 摘 grep+run_shell）
  **全部 28/28**。三个诚实的结论：
  ① 这几道题不测"会不会用 grep"（沙箱只有 5-9 个文件，通读就够）；
  ② ⭐ 消融有**漏洞**：`run_shell` 是后门 —— 摘掉 grep 后 agent 转头就跑了
  shell 版 grep（**这也是为什么评测轨迹必须记工具参数**）；
  ③ ⭐⭐ 就算一次命令都跑不了，agent 依然全过 —— 这几道题考的是
  **代码理解 + 推理**，不是工具使用。
- 测试套件 419 → **451 个用例全绿**（新增 32 例，其中 hook 机制 26 例）。

---

## [0.2.0] — 2026-10-24

**Phase 1：把「半成品」补完 + 建立可信的测量能力**

这一轮的主题不是加功能，而是——**把三个「定义了却没接上」的半成品补完，
并给评测体系补上「测量误差」这一块拼图。**

### 新增

- **双可见性（Dual Visibility）**：上下文压缩时不再原地重排消息，改为打
  `agentVisible=false` 标记 —— 模型看摘要、用户看完整历史（面板内灰显 + 「已压缩」角标）。
  借鉴 goose 的 `context_mgmt/mod.rs:89-226`。
- **并行工具调用**：只读工具一批并行执行，写/执行类工具仍串行。
  结果严格按原始 `tool_calls` 顺序回填（协议要求，乱序直接 400）。
  借鉴 nanobot 的 `_partition_tool_batches`。
- **重复调用检测**：文件读取四重校验（参数一致 + 内容 hash 未变 + 结果 hash 一致 +
  **原结果仍在模型上下文里**）+ grep 节流。写操作后查询计数自动失效
  （结果变了就该重查）。借鉴 nanobot 的 `file_state.py` + `runtime.py`。
- **Prompt 快照测试**：3 个系统提示词快照 + 5 条硬断言（含 API Key 防泄密）。
  借鉴 goose 的 `prompt_manager.rs` insta 快照测试。
- **评测方差统计**：`npm run eval -- --repeat N`，输出每题的通过率 / token 均值 /
  标准差 / **变异系数 cv** / 波动标记，并给出显著性判定（差异 > 2σ 才算真差异）。

### 修复

- 测试套件从 338/340 恢复为全绿：`vitest.config.mts` 未配 `testTimeout`（默认 5s），
  而两条「评测铁律」守卫测试需跑完 18 道题的 check.js（实测 6.5s / 10.7s）而超时
- 评测数据过期：`eval/results.json` 停留在 2026-10-21，而 6 个核心文件在 10-22 有大改动。
  本轮重跑基线并按 commit 归档到 `eval/baselines/`
- 压缩时若把已压过的历史也送去摘要，会出现「摘要套摘要、越滚越失真」——
  `maybeCompact` 现在只总结 `agentVisible !== false` 的消息

### 实测收益（基线 commit `6bb6b92` → 本轮）

| 指标 | 基线 | 本轮 | 变化 |
|---|---|---|---|
| Pass Rate | 100%（18/18） | 100%（18/18） | 持平，**0 回归** |
| 总 token | 1,113,577 | 985,245 | **-11.5%** |
| LLM 调用数 | 203 | 173 | **-14.8%** |
| 总耗时 | 425.8s | 369.5s | **-13.2%** |
| 总成本 | ¥2.545 | ¥2.273 | **-10.7%** |

### 已知边界

- **评测集已饱和**：pass rate 100% 失去区分度，后续优化需看 token / 轮数 / 耗时，
  或补充更难的题目（真实构建 / 长仓库 / 多文件一致性）

---

## [0.1.0] — 2026-10-23

首个可用版本。定位：为中文开发者优化的 VS Code AI 编程助手，核心是
**带回归检测的自评测体系** + **协议层自愈** + **BYOK 零成本模式**。

### 核心能力

- **ReAct Agent 循环**：流式响应、AbortSignal 中断、触顶强制收尾
- **9 个工具**：`read_file` `grep` `glob` `list_dir` `record_note`
  `apply_patch` `write_file` `restore_file` `run_shell`
- **三档权限**：只读 / 写入需确认 / 全部需确认，只读操作任何档位都不弹窗
- **文件级 checkpoint**：每次写入前自动快照，`/undo` 与 `restore_file` 一键回滚
- **BYOK 模式**：零内置密钥，用户自带 Key，支持 DeepSeek / MiniMax / OpenAI / Ollama

### 三个特色

- **自动跑测试 + 自动修**：保存源码 → 找相关测试 → 按退出码判定 → 失败提示 AI 修（最多 3 轮）
- **中文 commit 规范**：`功能:` / `修复:` / `文档:` / `重构:` / `测试:` / `样式:` / `杂项:`
- **错题本自动归档**：AI 通过 `record_note` 写入「原因 / 踩坑 / 测试」富条目，按日期归档

### 上下文与成本治理

- **技能包渐进式加载**：索引进 system prompt，正文由模型按需 `read_file`
- **大输出外置**：超 8000 字符落盘，回灌头尾预览 + 可 `offset/limit` 精准读取
- **自动压缩**：按上下文窗口 70% 触发，中英文分别估算 token
- **成本统计**：token 用量 + 金额 + 最贵 3 题 + 每通过一题成本
- **单一真相源** `agent/limits.ts`：迭代上限同时约束代码与 system prompt，避免提示词漂移

### 可靠性

- **中断续跑**：旁路 checkpoint 快照，恢复时显式告知「未执行」且**绝不重跑已产生副作用的工具**
- **历史自愈**：孤儿 `tool_call` / 孤立 tool 消息自动修复，救回磁盘上已损坏的会话
- **会话持久化**：JSONL 落盘，关掉 VS Code 再打开对话还在

### 评测体系

- 18 道题，三档难度（普通 / 困难 / L3 对抗）
- **L4 回归检测**：baseline → after 三方比对，能识别「改对目标、弄坏别处」这类
  agent 自己发现不了的失败
- **出题四铁律**：必须可自动判定 / ≥2 个回归守卫 / ≥1 个待修复 case / 必须有可解性校验
- 实测基线：pass rate 94%（17/18），0 回归，¥2.48 / 18 题

### 工程

- TypeScript 5.3+ / VS Code Extension API 1.86+
- React 18 + Vite 5 webview
- 340 个测试用例 / 23 个文件全绿（0.2.0 起为 392 个 / 26 个文件）
- 环境自检 `/doctor`、日志导出、状态栏入口

---

[0.2.0]: https://github.com/Yg-ui555/vscode-mini-coder/releases/tag/v0.2.0
[0.1.0]: https://github.com/Yg-ui555/vscode-mini-coder/releases/tag/v0.1.0