# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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