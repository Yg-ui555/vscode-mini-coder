# Mini-Coder · F5 跑通指南

> 第一次按 F5 调试扩展前，先看完这个。验证清单按顺序走，**每步都标了"OK 才进下一步"**。

## 0. 前置检查（30 秒）

```bash
cd D:/projects/vscode-mini-coder
npm run compile         # 应该 tsc 干净通过
npm run build:webview   # 应该 vite build 成功
npm test                # 应该 225/225 全绿
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
- **主窗口右下角状态栏**会出现两项：`$(sparkle) Mini-Coder`（点它打开聊天面板）
  和紧挨着它的**权限档位**（`$(shield-half) 写入需确认`，点它切换只读 / 写入需确认 / 全部需确认）
- 验证：开发者工具 → Console 应该看到 `Mini-Coder 激活` 日志，
  以及「输出 → Mini-Coder」里的 `状态栏入口已注册：Mini-Coder` 和 `权限档位状态栏已注册`

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
- [ ] 主窗口右下角状态栏出现 `Mini-Coder`（点它能打开聊天面板）
- [ ] Output → "Extension Host" 有 `Mini-Coder 激活` 日志
- [ ] 命令面板能找到 `Mini-Coder:` 命令（含「恢复历史会话」「列出历史会话」）
- [ ] 设置 API Key 弹窗 + 实际保存成功
- [ ] 打开聊天面板正常显示 Webview
- [ ] `/doctor` 输出的「生效配置」和实际用的 provider/模型一致
- [ ] `/test` slash command 跑测试有反馈
- [ ] 自动测试特色：保存测试文件 → 自动 pytest → 通过 / 失败提示
- [ ] 中文 commit 特色：生成中文 commit message
- [ ] 错题本：`.notes/今天.md` 自动创建
- [ ] ⭐ 搜索工具：让 agent 找一个符号的定义处，应显示 `grep` 调用并给出 `文件:行号`
- [ ] ⭐ `/undo`：让 agent 改一个文件 → 执行 `/undo` → 文件恢复原样
- [ ] ⭐ 会话持久化：聊几句 → 关掉 VS Code → 重开 → 面板里对话还在
- [ ] ⭐ 权限档位：状态栏切到 **只读** → 让 agent 改文件 → 应被拒绝且文件没变；
      再切回 **写入需确认** → 改文件应弹窗确认
- [ ] ⭐ `/permissions` 列出三档并标出当前档位；`/doctor` 里也能看到档位和本档拦哪些工具
- [ ] Agent 自然语言任务：能调工具完成任务

## 8. 常见问题排查

| 现象 | 原因 | 解决 |
|---|---|---|
| Webview 显示 "⚠ Webview 未构建" | dist-webview 没生成 | `npm run build:webview` |
| **聊天面板一片空白（没有任何报错）** | Webview 的 CSP 把前端脚本拦掉了 | 见下面第 8.1 节，**先别瞎改代码** |
| 命令面板找不到 Mini-Coder 命令 | tsc 没编译 | `npm run compile` 重启 |
| API 错误 401 | Key 填错 | 命令面板 → 重新设置 API Key |
| API 错误 429 | LLM rate limit | 换 provider 或等几分钟 |
| 自动测试不触发 | 文件路径不含 test/spec | 改 tests/ 目录下的文件名 |
| 中文 commit 返回 "功能: 更新代码" | git diff 为空 | 先 `git add` 或确认有未保存改动 |

### 8.1 空白面板专项排查（2026-10-28 踩过，整了半天才定位）

**症状**：聊天面板打开后**完全空白**。控制台干净，没有 stack，没有 error log。

**先做这三件事**（按顺序，前两步零成本）：

1. **看日志**：命令面板 → `Mini-Coder: 显示日志面板`
   - 看到 `Webview 已就绪，前端脚本执行成功` → 脚本没问题，问题在别处
   - 看到 `Webview 未就绪：5 秒内没有收到前端发来的 ready 消息` → **就是 CSP 拦了脚本**

2. **看面板上的字**：现在 `#root` 里有一段静态兜底提示。
   - React 挂载成功 → 提示自动消失（正常）
   - 提示**一直停着** → 脚本确实没跑，提示里就写了排查方向

3. **重载窗口**：`Ctrl+Shift+P` → `Developer: Reload Window`
   - ⚠️ **装完扩展一定要重载**。VS Code 不会自动重载已安装的扩展，
     而 webview 的 HTML 是**面板创建时一次性写死**的 —— 不重载，你装的是新代码，
     跑的却还是旧代码。这是最容易被忽略的一步。

4. 还不行就看真正的浏览器控制台：
   `Ctrl+Shift+P` → `Developer: Toggle Developer Tools` → Console 里找 `Content Security Policy` 报错。

**为什么以前修不好**：这个坑有三层，每层单独看都"没问题"：

| 层 | 内容 |
|---|---|
| ① | VS Code 1.142 把扩展的 HTML 塞进 **sandbox iframe**，不再是直接渲染 |
| ② | 它只会自动重写 CSP 里的 `vscode-resource:` **旧式端点** |
| ③ | 而 `webview.cspSource` 的真值是 `'self' https://*.vscode-cdn.net` —— 一个 **source 列表**，硬拼进 CSP 在版本间会失配 |

> 旧代码的 CSP 里**没有 nonce**，所以一旦失配就**没有任何兜底** → 静默白屏。
> 现在改成官方规范（`script-src 'nonce-${nonce}'`），nonce 每次随机生成，
> **不依赖任何域名推断**。
> 细节见 `src/webview/html.ts` 的注释，回归测试见 `src/__tests__/webview/html.test.ts`。

## 9. 重新启动 / 调试

任何代码改动后：
- Extension 端代码（`src/`）→ VS Code 自动 watch 重编译（`tsc --watch`）→ 直接 `Ctrl+R` 重启 Extension Host 窗口
- Webview 代码（`webview-ui/`）→ 手动 `npm run build:webview` → `Ctrl+R` 重启 Extension Host

调试时记得：**Extension Host 窗口是独立进程**，出错信息在主窗口的 Output → "Extension Host" 里，不是在 Extension Host 窗口本身。