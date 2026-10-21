# Mini-Coder AI 编程助手 · 项目说明

> 项目定位、特色、技术栈、路线。**先把项目做好**为第一性原则。

## 一、项目是什么

为 VS Code 开发的 AI 编程助手扩展，支持：
- 自然语言改代码（apply_patch 结构化编辑）
- 自动跑测试 + 自动修复
- 中文 commit 规范
- 错题本自动归档
- BYOK（自带 API Key）模式

## 二、跟参考项目的关系

| 参考 | 出品方 | 用途 |
|---|---|---|
| `nanobot-main` | HKUDS（港大数据智能实验室）| Python 写的 Claude Code 风格智能体框架 |
| `goose-main` | Block（Square 母公司）| Rust 写的工业级 AI coding agent |

**我们的做法**：用 TypeScript 重写最核心的 agent loop + tools + BYOK 模式，加 **3 个差异化特色**（别人没做或做得差）。

## 三、3 个差异化特色

### 特色 1：自动跑测试 + 自动修 ⭐⭐⭐⭐⭐

- **痛点**：改完不跑测试，提 PR 才失败
- **别人做法**：Cline / Continue 改完让用户自己跑
- **我们做法**：保存测试文件 → 自动 pytest → 失败 → 一键 AI 修复
- **为什么没人做**：他们觉得"改完用户自己跑"；我们认为"自动跑 + 自动修 = 省用户 5 分钟 × 每天"

### 特色 2：中文 commit 规范 ⭐⭐⭐⭐⭐

- **痛点**：英文 commit message 难写（措辞难、缩写多）
- **别人做法**：conventional commit（英文 `feat:` / `fix:`）
- **我们做法**：中文规范（`功能:` / `修复:` / `文档:` / `重构:` / `测试:` / `样式:` / `杂项:`）
- **为什么没人做**：国外项目为主，英文 commit 国际通用；国内开发者写中文 commit 是刚需

### 特色 3：错题本自动归档 ⭐⭐⭐⭐⭐

- **痛点**：改完就忘为什么改、踩了什么坑
- **别人做法**：改完不记录
- **我们做法**：每次修改 → 自动写到 `.notes/今天.md`，按日期/文件归档
- **为什么没人做**：要做"个人记忆"层，技术上要持久化，竞品懒得做

## 四、技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript 5.3+ | VS Code 官方语言 |
| 框架 | VS Code Extension API 1.86+ | 编辑器上下文原生集成 |
| UI | React 18 + Vite 5 | Webview 聊天面板 |
| LLM | OpenAI 兼容协议 | 支持 MiniMax / DeepSeek / OpenAI / Ollama |
| 测试 | pytest + vitest | 自动跑测试特色 |
| 包管理 | npm + 淘宝镜像 | 国内加速 |

## 五、架构

```
src/
├── extension.ts           ← 入口 + 激活 + 命令注册
├── config.ts              ← BYOK 配置（SecretStorage + .env）
├── agent/
│   ├── provider.ts        ← OpenAI 兼容流式 Provider
│   ├── loop.ts            ← ReAct 主循环（max_iterations=30）
│   ├── context.ts         ← System prompt 拼装
│   └── tools/
│       ├── base.ts         ← Tool 接口
│       ├── registry.ts     ← ToolRegistry
│       ├── readFile.ts     ← 读文件（30k 截断）
│       ├── writeFile.ts    ← 写文件
│       ├── applyPatch.ts  ← 杀手特性：结构化编辑 + rollback
│       └── runShell.ts     ← 跨平台 shell（Windows 兼容）
└── features/
    ├── autoTest.ts        ← 特色 1：自动测试
    ├── zhCommit.ts        ← 特色 2：中文 commit
    └── notes.ts            ← 特色 3：错题本
```

## 六、BYOK 模式（重要）

**BYOK（Bring Your Own Key）= 用户自带 API Key**。

**为什么这样设计**：
- 扩展不内置任何 API Key → 开发者零成本
- 用户填的 Key 加密存在 VS Code SecretStorage → 安全
- 用户花钱 = 用户自己的费用 → 不破产风险

**优先级**：`.env` 文件 > SecretStorage > 弹窗引导

## 七、12 周路线

| 周 | 阶段 | 验收 |
|---|---|---|
| W1 | 环境 + Hello World | F5 弹 Extension Development Host |
| W2 | Webview 通信 | 聊天面板输入显示 |
| W3~W5 | Agent 核心 + 6 工具 | 端到端跑通 5 道 LeetCode |
| W6 | 3 个特色 | 自动测试 + 中文 commit + 错题本 |
| W7 | 评估 + 打磨 | pass rate ≥ 80% |
| W8 | 发布准备 | icon + 截图 + 文档 |
| W9 | `vsce publish` | Marketplace 上能搜到 |
| W10~W12 | 0 推广 + 博客 | 1000+ 下载 |

### W7 评测集已建成（2026-10-20）

14 道题，三档难度：

| 档位 | 编号 | 数量 | 考什么 |
|---|---|---|---|
| 普通 | 01~10 | 5 | 工具用得对不对、单点改动正不正确 |
| 困难 | 11~19 | 4 | 多步规划、跨文件一致性、长链条不跑偏 |
| **L3 对抗** | 21~29 | 5 | **有没有判断力**——会不会被骗、越界、讨好用户 |

**跑法**：
```bash
npm run eval --dry   # 不花钱，验证框架
npm run eval         # 真跑（需 .env 配 API Key，约 ¥1~3）
```

**产物**：`eval/RESULTS.md`（人读）+ `eval/results.json`（机读）

#### ⭐ L4 回归检测（本评测集的核心设计）

每道题跑两遍 check：agent 干活**前**跑一次拿 baseline，干活**后**跑一次拿 after，
三方比对得出四种结果：

| baseline | after | 含义 |
|---|---|---|
| ✅ | ✅ | 保持通过 |
| ❌ | ✅ | **本题达成** |
| ✅ | ❌ | ⭐ **回归** —— agent 把对的改坏了 |
| ❌ | ❌ | 没达成 |

**为什么这层最重要**：AI 编程助手最典型的失败不是"没改对"，
而是"改对了目标、把别处改坏了"。而这个 bug **agent 自己发现不了** ——
它跑一次测试看到绿色就收工了。

只统计最终过不过，这类失败 100% 被掩盖。

#### 出题三条铁律（防止自己骗自己）

1. **必须可自动判定**，不许 LLM 打分（LLM 判分 = 自我麻醉）
2. **每题至少 2 个 case 在初始代码上就通过**（回归守卫，否则 L4 是摆设）
3. **每题至少 1 个 case 在初始代码上必须挂**，且对应 task.md 明确要求的新增能力
   （否则 agent 什么都不做也满分）

第 3 条是硬约束，`src/eval/verifyTasks.ts` 会把违反的题判为废题。

### ⚠️ 诚实记录：当前真实进度

| 项 | 状态 |
|---|---|
| 工具数量 | **9 个**：read_file / grep / glob / list_dir / record_note / apply_patch / write_file / restore_file / run_shell |
| 测试 | **171 个用例 / 16 个文件全绿** |
| pass rate | **100%（14/14，DeepSeek）** —— ⚠️ 评测集已饱和，详见下方 |
| 工具注册 | 单一工厂 `agent/tools/factory.ts`，面板 / 评测 / 自检 / 自动修 四处共用一份定义 |
| 文件回滚 | ✅ checkpoint + `/undo` + `restore_file`（goose / nanobot 都没有这个能力） |
| 会话持久化 | ✅ JSONL 落盘，关掉 VS Code 再打开对话还在 |
| Token 计数 | ✅ 中英文分别估算，按上下文窗口 70% 触发压缩 |
| autoTest | ✅ **2026-10-21 重写**：源码变更也会触发、退出码判定、防抖、最多修 3 轮 |
| zhCommit | ✅ 已修 untracked 文件漏读 + `type` 命令不可靠 |
| notes | ✅ **2026-10-21 重写**：`record_note` 工具写富条目（原因/踩坑/测试），索引页 + 去重 |
| 缺失能力 | 三档权限分级（工具元数据已就位，UI 未接）、diff 预览确认、MCP、Skills、中断续跑 |
| 已知硬伤 | autocompact 已改为「保住 tool 消息 + 压缩后补 continuation」 |

### ⚠️ 评测集已饱和（2026-10-21 首次真跑）

首次真实跑批：**14/14 全过，0 回归，0 错误**（deepseek-chat，312 秒）。

每题都是「全部目标 case 修好 + 零残留」，不是「修一个就算过」的宽松判定。

**但满分本身是危险信号** —— 项目自己的 `eval/README.md` 写过「高分说明题目太简单」。
现在改 prompt / 调工具 / 换模型，数字都不会动，**失去了反馈信号**。

现有 14 题的共同短板：**全是自包含的单个 JS 文件**。下一批要补：

| 维度 | 覆盖情况 | 为什么重要 |
|---|---|---|
| 多文件 + 真实构建 | ❌ 全是单文件 | 真实改动要过 `tsc` / `npm test` 才算数 |
| 长仓库探索 | ❌ 文件都在沙箱根 | 真实目标在 5 层外，要 grep 定位 + 多次跳转 |
| **工具纪律** | ❌ 没有 | 不该用 `run_shell` 时用了、不该改测试时改了 → 应判失败 |
| 成本约束 | ❌ 没有 | 限 token 预算，看它会不会绕远路 |
| token 用量统计 | ❌ 框架没记 usage | 现在不知道花了多少钱、哪题最贵 |

### 🆕 2026-10-21 加固记录

**新增**：grep / glob / list_dir / record_note 四工具 · 文件 checkpoint 回滚 · restore_file · 会话 JSONL 持久化 · token 计数 · 工具元数据 · 状态栏入口 · `mini-coder.autoTestMode` 设置项

**修掉的 bug**：

| Bug | 影响 |
|---|---|
| 相对路径按 `process.cwd()` 解析 | ⭐ **影响生产**：从别的目录启动 VS Code 时，所有相对路径编辑都会被误判成越界而拒绝 |
| glob 剪枝过度 | 模式以 `*` 开头时中间目录被全部剪掉，工具永远返回「没有匹配」——极具误导性 |
| **autoTest 触发条件反了** | ⭐ 只有测试文件变更才跑测试；用户改源码什么都不发生，特色形同虚设 |
| **autoTest 用 includes('passed') 判定** | ⭐ `"3 failed, 5 passed"` 里就有 passed → 测试挂了也判通过 → 永不触发 AI 修复，核心闭环断裂 |
| 记录错题本与 features/notes 循环依赖 vscode | 工具层加载即崩（评测 CLI / 纯 node 环境） |
| 设置项没接 `getConfiguration` | 用户在设置界面改 provider / model 完全无效果 |
| `MINI_CODER_BASE_URL` 没人读 | MiniMax 国内站 / 国际站无法切换 |
| `process.cwd()` 当工作目录 | run_shell / autoTest / zhCommit 可能在用户没预期的目录执行 |
| 工具注册散落 4 处 | 评测环境能力 ≠ 用户能力，pass rate 直接失真 |

## 八、成本（真干 + 0 推广 + 省钱）

| 类目 | 12 周 | 12 个月 |
|---|---|---|
| LLM API（DeepSeek 主力 + MiniMax） | 200 元 | 600 元 |
| 推广 | **0 元** | 0 元 |
| 工具（域名） | 50 元 | 0 元 |
| **合计** | **~250 元** | **~600 元** |

## 九、风险与对策

| 风险 | 对策 |
|---|---|
| Webview 通信调试不掉 | W2 专攻，看 Continue 源码 |
| LLM 输出 JSON 格式错 | retry + 友好错误 |
| agent 死循环 | max_iterations=30 兜底 |
| Marketplace 审核被拒 | icon 不能 emoji、名称不违规 |
| 推广没效果 | 0 推广档不花钱 |

## 十、参考资源

- `D:\AI agent\nanobot-main` — Python 版 Claude Code 复刻
- `D:\AI agent\goose-main` — Rust 工业级 AI coding agent
- `D:\AI class\ragflow-main` — RAG 框架参考
- `D:\AI 智能体学习资料库\05_Agent智能体` — Agent 学习资料

## 十一、定位总结

> **我们做的不是"又一个 Cline 仿写"**，而是 **VS Code 插件版 + 国内开发者友好（中文 + MiniMax）+ 真干（自动测试/中文 commit/错题本）**。

差异化 3 个特色都是 **别人没做或做得差的**，用户天天用 → 高留存 → 高评分 → 简历最强叙事。

---

**下一步**：
1. F5 跑通（验证激活）
2. 写 Webview UI（W2）
3. 跑 LeetCode 评测（W7）
4. 发布到 Marketplace（W9）