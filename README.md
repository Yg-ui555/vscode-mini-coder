# Mini-Coder AI 编程助手

一个**为中文开发者优化**的 VS Code AI 编程助手。三个核心特色：

1. **自动跑测试 + 自动修**：保存代码 → 找到相关测试 → 自动跑 → 失败 → AI 一键修复
2. **中文 commit 规范**：`功能:` / `修复:` / `文档:` / `重构:` 等
3. **错题本自动归档**：AI 把「为什么这么改、踩了什么坑、测试过没有」写进 `.notes/`，按日期归档

## 命令列表

- `Mini-Coder: 设置 API Key` — 设置或更换 API Key
- `Mini-Coder: 打开聊天面板` — 打开 AI 聊天面板（也可点右下角状态栏）
- `Mini-Coder: 自动跑测试` — 跑全项目测试，失败可让 AI 修
- `Mini-Coder: 生成中文 commit` — 自动生成中文 commit message
- `Mini-Coder: 查看今日错题本` — 打开今天的错题记录
- `Mini-Coder: 列出错题本归档` — 查看所有归档日期
- `Mini-Coder: 恢复历史会话` — 切换到之前的对话（对话自动落盘，关掉 VS Code 也在）
- `Mini-Coder: 列出历史会话` — 查看当前工作区的全部历史会话
- `Mini-Coder: 环境自检` — 一键诊断配置问题
- `Mini-Coder: 权限档位` — 切换只读 / 写入需确认 / 全部需确认（也可以点状态栏）

### 聊天面板里的快捷命令

| 命令 | 作用 |
|---|---|
| `/test` | 跑项目测试（pytest / npm test） |
| `/commit` | 生成中文 commit message |
| `/notes` | 查看今天的错题本 |
| `/solve <题号>` | 解 LeetCode 题目 |
| `/undo` | **撤销 AI 最近一次文件修改**（一键退回原样） |
| `/sessions` | 列出历史会话 |
| `/permissions` | 查看 / 切换权限档位 |
| `/doctor` | 环境自检（含当前权限档位） |
| `/logs` | 复制日志到剪贴板 |

## 权限档位：它在多大范围内能动你的代码

三档，设置项是 `mini-coder.approvalMode`，也可以点状态栏那一项快速切。

| 档位 | 改文件 | 跑 shell 命令 | 适合什么时候 |
|---|---|---|---|
| **只读** | 直接拒绝 | 直接拒绝 | 先把它当「能读你整个仓库的搜索引擎」用，不放心它的判断时 |
| **写入需确认**（默认） | 弹窗确认 | 只在命中高危特征时确认 | 日常写代码。改文件本来就有 `/undo` 兜底，确认一次就够 |
| **全部需确认** | 弹窗确认 | **每一条都确认** | 只想让它跑构建和测试，不想它顺手执行任何别的东西 |

两条不变的规则：

- **只读操作（读文件 / 搜索 / 列目录）在任何档位都不弹窗。** 每读一个文件弹一次窗，这个功能会立刻变得没法用——用户的反应不是「更安全了」，而是「烦死了全关了」，安全反而形同虚设。
- **改文件永远有 checkpoint 存档**，改错了用 `/undo` 一键退回。

执行类工具（`run_shell`）在「全部需确认」档下**不提供「本次会话都允许」**：命令的副作用在 agent 控制之外（可能已经推了远端、删了文件），一句话就把这一整类风险全开了，这个口子不该开。

## 三个特色的实际行为

### 1. 自动跑测试

保存文件后自动触发（可用 `mini-coder.autoTestMode` 调整）：

| 你改了什么 | 会发生什么 |
|---|---|
| 测试文件 | 直接跑这个测试文件 |
| 源代码 | 找出引用了它的测试，只跑那些（找不到就不跑，避免假绿灯） |
| 连续保存多个文件 | 1.5 秒防抖，合并成一次 |

跑完失败会问你「要不要 AI 自动修」，修完**按退出码**重新验证（不是 `includes('passed')`—— 那种写法在 `3 failed, 5 passed` 上永远判通过）。最多修 3 轮，还不通过就停下来问人，不会无限烧钱。

### 2. 错题本

`.notes/2026-10-21.md` 长这样：

```markdown
## 16:37 ⭐ 修 autoTest 的 includes(passed) 误判

原来判断用的是 output.includes("passed")，但 pytest 失败时输出是
"3 failed, 5 passed"，这行字里就有 passed，于是永远判定通过。

**改动**：
- `autoTest.ts` — didTestsPass 改用退出码

**踩到的坑**：
- 同一个文件里 :82 的注释写了不能用 includes 判断，:276 又犯了一次

**测试**：vitest → 16 passed
```

富条目由 AI 通过 `record_note` 工具在任务结束时写入（只有它知道原因和坑），文件保存事件只记一行轻条目兜底。

### 3. 中文 commit

`功能:` / `修复:` / `文档:` / `重构:` / `测试:` / `样式:` / `杂项:`

---

## 两个差异化能力

### 改错了能一键退回

每次 AI 写文件之前会自动存快照（`.mini-coder/checkpoints/`，已 gitignore）。

- 一次改动多个文件 = 一个快照，点一次 `/undo` 全部退回
- 新建的文件也存快照 —— 撤销时直接删掉
- AI 自己发现改错了，也能调 `restore_file` 主动回滚

> 参考：goose 官方 blog 承认 *"conversational memory isn't a snapshot of your codebase"*；nanobot 全仓没有文件级 undo。**这两家都没做这个能力。**

### 9 个工具，其中 3 个是搜索

`grep`（按内容搜，返回 `文件:行号:内容`）、`glob`（按文件名模式找）、`list_dir`（列目录）。

自动跳过 `node_modules` / `.git` / `dist`，不会卡死。

## 开发

```bash
npm install
npm run compile
npm run build:webview
npm test                    # 225 个用例
npm run eval:verify         # 校验每题 baseline 设计合格
npm run eval:solvable       # 校验每题不是废题（跑人写的标准答案）
# 按 F5 跑 Extension Development Host
```

详见 [RUN.md](RUN.md)（F5 跑通指南）和 [PROJECT.md](PROJECT.md)（项目说明与路线）。

## 架构

```
src/
├── agent/                 Agent 核心（provider / loop / context）
│   ├── tools/             9 个工具 + 工厂 + 元数据 + 路径白名单 + 三档权限
│   └── checkpoint/        文件快照与回滚
├── session/               会话 JSONL 持久化
├── features/              3 个特色（autoTest / zhCommit / notes）
├── util/                  纯逻辑（token 计数、错题本存储、成本估算）
├── eval/                  评测框架（18 道题，L4 回归检测）
└── config.ts              BYOK 配置（.env > 设置项 > SecretStorage）
```