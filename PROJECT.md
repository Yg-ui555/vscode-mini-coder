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