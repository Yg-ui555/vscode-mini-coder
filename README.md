# Mini-Coder AI 编程助手

一个**为中文开发者优化**的 VS Code AI 编程助手。三个核心特色：

1. **自动跑测试 + 自动修**：保存文件 → 自动 pytest → 失败 → AI 一键修复
2. **中文 commit 规范**：`功能:` / `修复:` / `文档:` / `重构:` 等
3. **错题本自动归档**：每次修改自动写到 `.notes/今天.md`，按日期/文件记录

## 配置 API Key

本扩展采用 **BYOK**（自带 API Key）模式，**不内置任何 API key**，零成本零风险。

第一次启动会弹窗让你填：

| Provider | base_url | model 示例 |
|---|---|---|
| DeepSeek（推荐） | `https://api.deepseek.com/v1` | `deepseek-chat` |
| MiniMax | `https://api.minimax.io/v1` | `MiniMax-M3` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Ollama（本地）| `http://localhost:11434/v1` | `qwen2.5-coder:7b` |

填过的 key 加密存在 VS Code SecretStorage，不会上传。

## 命令列表

- `Mini-Coder: 设置 API Key` — 设置或更换 API Key
- `Mini-Coder: 打开聊天面板` — 打开 AI 聊天面板
- `Mini-Coder: 自动跑测试` — 自动跑测试并修复
- `Mini-Coder: 生成中文 commit` — 自动生成中文 commit message
- `Mini-Coder: 查看今日错题本` — 打开今天的错题本

## 开发

```bash
npm install
npm run compile
# 按 F5 跑 Extension Development Host
```

## 架构

- `src/extension.ts`：扩展入口，激活 + 命令注册
- `src/agent/`：Agent 核心（provider、loop、context）
- `src/agent/tools/`：Tool 工具集（read/write/applyPatch/runShell）
- `src/features/`：3 个特色（autoTest、zhCommit、notes）
- `src/config.ts`：BYOK 配置