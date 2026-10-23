# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
- 340 个测试用例 / 23 个文件全绿
- 环境自检 `/doctor`、日志导出、状态栏入口

---

[0.1.0]: https://github.com/Yg-ui555/vscode-mini-coder/releases/tag/v0.1.0