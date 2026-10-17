# Mini-Coder · F5 跑通指南

> 第一次按 F5 调试扩展前，先看完这个。验证清单按顺序走，**每步都标了"OK 才进下一步"**。

## 0. 前置检查（30 秒）

```bash
cd D:/projects/vscode-mini-coder
npm run compile         # 应该 tsc 干净通过
npm run build:webview   # 应该 vite build 成功
npm test                # 应该 15/15 全绿
```

如果任何一步失败，先解决再按 F5。

## 1. VS Code 打开项目

```bash
code D:/projects/vscode-mini-coder
```

打开后确认右下角有这些目录：
- `src/` — TypeScript 源代码
- `webview-ui/` — Webview React 代码
- `out/` — tsc 编译产物（已经存在）
- `dist-webview/` — vite 构建产物（已经存在）
- `node_modules/` — 依赖

## 2. 按 F5 启动 Extension Development Host

- VS Code 自动调用 `.vscode/launch.json` 配置
- 新窗口标题栏会显示 `[Extension Development Host]`
- 主窗口右下角状态栏：**Mini-Coder 激活** 提示应该弹出来
- 验证：开发者工具 → Console 应该看到 `Mini-Coder 激活` 日志

**如果没看到**：打开主窗口的 Output → "Extension Host" 看错误。

## 3. 首次配置 API Key（BYOK 模式）

激活时如果没有 .env 或 SecretStorage 里有 key，会弹窗问"立即设置 / 稍后"。

点 **"立即设置"**：

1. 弹窗让你填 API Key（password 框）
   - 测试用：直接用 `.env` 里已填的 `MINIMAX_API_KEY`（开发优先级高于弹窗）
   - 或填你的真实 DeepSeek / OpenAI / Ollama key
2. 选择 Provider（minimax / deepseek / openai / ollama）
3. 选完 OK

**验证**：命令面板 (`Ctrl+Shift+P`) → 输入 `Mini-Coder: 设置 API Key`，再跑一次，应该不会弹窗（说明已存）。

## 4. 打开聊天面板

命令面板 → `Mini-Coder: 打开聊天面板`（或绑定的快捷键）。

应该看到：
- 右侧弹出一个 Webview 面板
- 空状态显示欢迎语 + 4 个示例任务
- 底部输入框 placeholder 含 "/test /commit /notes /solve"

**验证**：在输入框输入 `/test`，回车。看到 `/test` 跑项目测试。

## 5. 跑一次完整链路

### 5.1 测试 slash command

输入 `/test` 回车。

**预期**：Webview 显示"🧪 正在跑测试..."→ 弹 "❌ 测试失败 X / X" 或 "✅ 测试全部通过"。
**注意**：项目本身没有测试，所以 pytest / vitest 会报 0 passed / 1 error，是正常的。

### 5.2 测试自动测试特色

随便新建一个 `tests/test_demo.py`：
```python
def test_pass():
    assert 1 + 1 == 2
```

保存。

**预期**：右下角弹 "📝 检测到测试文件变更" → 跑 pytest → 通过 → 弹 "✓ 测试通过"。

故意改 `assert 1 + 1 == 3` 触发失败。

**预期**：弹"测试失败。是否让 AI 自动修复？" → 点"AI 自动修" → AI 调 `apply_patch` 改回 1+1==2 → 再跑测试 → 通过。

### 5.3 测试中文 commit 特色

```bash
cd D:/projects/vscode-mini-coder
echo "// test" >> src/test.txt
```

到 Source Control 面板，点 ✓ 旁边的 `...` → `Mini-Coder: 生成中文 commit`。

**预期**：弹窗显示生成的中文 commit（形如 `功能: 加测试文件`），已复制到剪贴板。
点 "填入 commit 输入框"，message 自动填进去。

### 5.4 测试错题本特色

任意修改文件后，命令面板 → `Mini-Coder: 查看今日错题本`。

**预期**：打开 `.notes/今天.md`，包含今天改动记录。

## 6. 跑 Agent 自然语言任务

在聊天面板输入：`给 src/test.txt 加一行注释 "// added by agent"` 回车。

**预期**：
- 看到流式打字机效果（LLM 在思考）
- 工具调用日志（read_file → apply_patch）
- 最终回复"已加注释"

## 7. 验证清单

按这个清单逐项确认，**全部 ✅ 才算跑通**：

- [ ] F5 启动后新窗口标题是 `[Extension Development Host]`
- [ ] Output → "Extension Host" 有 `Mini-Coder 激活` 日志
- [ ] 命令面板能找到 5 个 `Mini-Coder:` 命令
- [ ] 设置 API Key 弹窗 + 实际保存成功
- [ ] 打开聊天面板正常显示 Webview
- [ ] `/test` slash command 跑测试有反馈
- [ ] 自动测试特色：保存测试文件 → 自动 pytest → 通过 / 失败提示
- [ ] 中文 commit 特色：生成中文 commit message
- [ ] 错题本：`.notes/今天.md` 自动创建
- [ ] Agent 自然语言任务：能调工具完成任务

## 8. 常见问题排查

| 现象 | 原因 | 解决 |
|---|---|---|
| Webview 显示 "⚠ Webview 未构建" | dist-webview 没生成 | `npm run build:webview` |
| 命令面板找不到 Mini-Coder 命令 | tsc 没编译 | `npm run compile` 重启 |
| API 错误 401 | Key 填错 | 命令面板 → 重新设置 API Key |
| API 错误 429 | LLM rate limit | 换 provider 或等几分钟 |
| 自动测试不触发 | 文件路径不含 test/spec | 改 tests/ 目录下的文件名 |
| 中文 commit 返回 "功能: 更新代码" | git diff 为空 | 先 `git add` 或确认有未保存改动 |

## 9. 重新启动 / 调试

任何代码改动后：
- Extension 端代码（`src/`）→ VS Code 自动 watch 重编译（`tsc --watch`）→ 直接 `Ctrl+R` 重启 Extension Host 窗口
- Webview 代码（`webview-ui/`）→ 手动 `npm run build:webview` → `Ctrl+R` 重启 Extension Host

调试时记得：**Extension Host 窗口是独立进程**，出错信息在主窗口的 Output → "Extension Host" 里，不是在 Extension Host 窗口本身。