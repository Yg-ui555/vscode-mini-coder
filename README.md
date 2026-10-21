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
- `Mini-Coder: 打开聊天面板` — 打开 AI 聊天面板（也可点右下角状态栏）
- `Mini-Coder: 自动跑测试` — 自动跑测试并修复
- `Mini-Coder: 生成中文 commit` — 自动生成中文 commit message
- `Mini-Coder: 查看今日错题本` — 打开今天的错题本
- `Mini-Coder: 恢复历史会话` — 切换到之前的对话（对话自动落盘，关掉 VS Code 也在）
- `Mini-Coder: 列出历史会话` — 查看当前工作区的全部历史会话
- `Mini-Coder: 环境自检` — 一键诊断配置问题

### 聊天面板里的快捷命令

| 命令 | 作用 |
|---|---|
| `/test` | 跑项目测试（pytest / npm test） |
| `/commit` | 生成中文 commit message |
| `/notes` | 查看今天的错题本 |
| `/solve <题号>` | 解 LeetCode 题目 |
| `/undo` | **撤销 AI 最近一次文件修改**（一键退回原样） |
| `/sessions` | 列出历史会话 |
| `/doctor` | 环境自检 |
| `/logs` | 复制日志到剪贴板 |

## 两个差异化能力

### 1. 改错了能一键退回

每次 AI 写文件之前，Mini-Coder 会自动存一份快照（存放在 `.mini-coder/checkpoints/`，已在 `.gitignore` 中）。

- 一次改动多个文件 = 一个快照，点一次 `/undo` 全部退回，不用点 N 次
- 新建的文件也存快照 —— 撤销时直接删掉
- AI 自己发现改错了，也能调 `restore_file` 工具主动回滚

> 参考：goose 官方 blog 承认 *"conversational memory isn't a snapshot of your codebase"*，让用户自己 git commit 救；nanobot 全仓没有文件级 undo。**这两家都没做这个能力。**

### 2. 找不到代码会自己搜

8 个工具，其中 3 个是搜索：

- `grep` — 按内容搜，返回 `文件:行号:内容`
- `glob` — 按文件名模式找
- `list_dir` — 列目录

自动跳过 `node_modules` / `.git` / `dist`，不会卡死。

## 开发

```bash
npm install
npm run compile
npm run build:webview
npm test              # 144 个用例
# 按 F5 跑 Extension Development Host
```

详见 [RUN.md](RUN.md)（F5 跑通指南）和 [PROJECT.md](PROJECT.md)（项目说明与路线）。

## 架构

- `src/agent/tools/`：工具层（8 个工具 + 工厂 + 元数据 + 路径白名单 + 审批）
- `src/agent/checkpoint/`：文件快照与回滚
- `src/session/`：会话 JSONL 持久化
- `src/agent/`：Agent 核心（provider、loop、context）
- `src/features/`：3 个特色（autoTest、zhCommit、notes）
- `src/eval/`：评测框架（14 道题，L4 回归检测）
- `src/config.ts`：BYOK 配置（`.env` > 设置项 > SecretStorage）