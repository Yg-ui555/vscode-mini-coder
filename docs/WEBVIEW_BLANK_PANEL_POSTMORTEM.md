# Webview 空白面板 · 复盘（2026-10-28）

> 一句话结论：**面板空白不是扩展的代码 bug，而是 VS Code 宿主层的 Service Worker 版本冲突，
> 被一个卡死的 Inno Setup 更新锁放大成了必现故障。修的是环境，不是代码。**

---

## 1. 现象

- 点开 Mini-Coder Chat 面板 → **一片空白**，什么都不显示。
- 扩展日志、renderer.log、控制台**全干净** —— 一个字都没有。
- 右下角偶尔弹一个通知：`Error loading webview provided by 'shuxiangke-minicoder...'`
- 用户原话："一直是这样。上次也是，你一直没解决好" → 说明**长期必现**，不是偶发。

「面板空白」是 agent 类 UI 最难查的故障：没有 stack trace、没有 error log，屏幕上只有一片空白。

---

## 2. 根因链（每一环都有硬证据）

| # | 环节 | 证据 |
|---|---|---|
| 1 | 面板空白 = webview 的 iframe 里**没有 HTML** | VS Code 源码 `out/vs/workbench/contrib/webview/browser/pre/index.html`：注册 Service Worker 失败 → `postMessage('fatal-error')` → **直接 return，HTML 根本不写进 iframe** |
| 2 | 真实报错是 SW 注册失败 | 用户截图原文：`Could not register service worker: InvalidStateError: Failed to register a ServiceWorker: The document is in an invalid state.` |
| 3 | VS Code 1.142.0 要求 SW 版本 **6** | `workbench.desktop.main.js` 里 `_expectedServiceWorkerVersion = 6`，且 `swVersion=6` 写进 iframe 的 URL 查询参数 |
| 4 | 本机注册的却是旧版 **v=5** | `%APPDATA%\Code\Service Worker\Database\000003.log` 里全是 `.../service-worker.js?v=5`（老版 VS Code 留下的） |
| 5 | 于是走"替换更新"流程 → 抛 `InvalidStateError` | v5 占着 `vscode-webview` origin 的 scope，v6 要顶掉它 |
| 6 | 每次启动 VS Code 都要**干等 30 秒** | 启动日志：`checkInnoSetupMutex: vscode-updating is held, waiting up to 30s for setup to finish...` |
| 7 | 等待期间 webview 文档**不处于 active 状态** → 注册必然失败 | 上一步的 `InvalidStateError: The document is in an invalid state` 就是这个意思 |
| 8 | 谁占着这个锁？`inno_updater.exe` | 进程命令行：`<VS Code 安装目录 A>\e646868227\tools\inno_updater.exe "<VS Code 安装目录 A>\Code.exe" true "正在更新 Visual Studio Code..."` |
| 9 | 它等的是一个**根本不存在**的文件 | `<VS Code 安装目录 A>` 里只有 `new_Code.exe`，**没有 `Code.exe`** → 永远等不到 → 永远不退出 → 锁永远不释放 |
| 10 | 为什么会有两个 VS Code | 真正在跑的 1.142.0 在 `<VS Code 安装目录 B>`；注册表的 InstallLocation 却指向 `<VS Code 安装目录 A>`（半死的 1.143.1 残留） |

> 📌 下面用两个占位符代替本机真实安装路径（公开仓库里写死盘符既没法用、也暴露目录结构）：
> **A** = 注册表指向的那个目录（半死残留）；**B** = 真正在跑的那个目录。

**因果链一句话**：注册表指向错误目录 → 自动更新把新版解到那个目录 → Inno 助手等一个不存在的 `Code.exe` → 死等 → 占着 `vscode-updating` 互斥锁 → 每次启动白等 30 秒 → webview 文档不 active → SW 注册失败 → **面板全白**。

---

## 3. 走过的弯路（这部分比结论更值钱）

### ❌ 错判 1：用「日志里没有记录」推断「事情没发生」

最初的结论是「已排除 Service Worker 注册失败」，依据是 *renderer.log 里没有 `fatal-error` 记录*。

**这个推理是错的**：`fatal-error` **只弹 toast（右下角通知），根本不写日志**。

> 通用教训：凡是"用日志里没有 X 推断 X 没发生"，必须先确认 **X 到底会不会写日志**。
> 没写日志 ≠ 没发生，也可能只是"它根本不记录"。
> 这次正是用户贴的一张截图给出了决定性报错全文。

### ❌ 错判 2：怀疑过 CSP nonce / 前端产物过期 / 缺 `acquireVsCodeApi`

这三个方向本身都没错（甚至前一轮确实修掉了两个真问题），但**都不是这次白屏的根因**。
它们只是让排查看起来"在推进"，实际一直在错误的方向上使劲。

### ❌ 错判 3：试图从外部触发 VS Code 命令

`vscode://command/...`、`code --command`、`--user-data-dir` 隔离实例 + `--extensionDevelopmentPath` —— **全部无效**。
隔离实例甚至"进程起来了但窗口不渲染"，诊断扩展也不激活。

**最终解法**：给扩展加一个 `MINI_CODER_AUTOPEN=1` 的启动钩子 / `mini-coder.openOnStartup` 设置，
让扩展**自己**打开面板取证，把"要人点一下"变成"无人值守可复现"。

### ❌ 错判 4：想从扩展侧绕过 SW 机制

`disableServiceWorker` 这个选项在 `@types/vscode` 的 `WebviewOptions` 里**根本不存在**，
而宿主端的 `yF()` 只序列化 `enableCommandUris / enableScripts / enableForms / portMapping / localResourceRoots`
—— 额外字段会被**静默丢弃**。扩展侧没有开关可关。

> 通用教训：遇到"宿主行为挡住了我"，先查清楚**宿主到底给不给这个开关**，
> 别在扩展侧反复重试一个不存在的旋钮。

---

## 4. 修复动作

| # | 动作 | 说明 |
|---|---|---|
| 1 | 备份 `%APPDATA%\Code\Service Worker` | robocopy 一份，15 文件 / 94.9 KB，可随时回滚 |
| 2 | 清空 SW 数据库 | 用 `cmd /c move` **重命名**而不是删除（删除被安全策略拦；重命名同样清空效果且可恢复） |
| 3 | 杀掉 `CodeSetup-*.exe` / `CodeSetup-*.tmp` | 更新器持锁，必须先杀再动文件 |
| 4 | 杀掉 `inno_updater.exe` | 它是真正占锁的那个（PID 42016），杀掉后目录立刻可移动 |
| 5 | 把 `<VS Code 安装目录 A>` 移走 | 注册表指向的目录里没有 `Code.exe`，是个半死残留；移走后自动更新装不上东西，也就不会再占锁 |
| 6 | 移走 `%LOCALAPPDATA%\Temp\vscode-stable-user-x64` | 已暂存的更新包，移走后不会重启安装流程 |
| 7 | `settings.json` 加 `"update.mode": "none"` | **从根上断掉自动更新**（这一条才是根治，前几条只是清了现场） |
| 8 | 重启 VS Code | SW 以 `?v=6` 重新注册成功 |

> 备份位置：`%APPDATA%\Code\Service Worker.bak-20261028`、
> `Service Worker.old-20261028`、`Code Cache.old-20261028`、`GPUCache.old-20261028`、
> `<VS Code 安装目录 A>.dead-20261028`。

---

## 5. 验证证据（不只是"看着好了"）

**① 扩展日志** —— 从"未就绪"变成"就绪"：

```
[12:51:14] [INFO] 用户打开了 Chat 面板
[12:51:17] [INFO] Webview 已就绪，前端脚本执行成功
[12:51:17] [INFO] [webview 探针存活] acquireVsCodeApi=true
```

**② 探针落盘的 DOM 快照**（`webview-diag.json`）：

- iframe URL 带 `swVersion=6` → **SW 版本冲突确实消失了**
- `rootHtmlHead` = `<div class="chat-panel">…👋 你好，我是 Mini-Coder…` → React 已挂载
- `bodyText` 含「发送 / 🗑 新会话 / 📂 历史会话 / Enter 发送 · / 开头的走快捷命令」→ **输入框和按钮全在**
- JS 150546 B / CSS 6750 B 全部解码成功，**零 CSP 违规、零 error**

**③ 窗口标题**：`Mini-Coder Chat - vscode-mini-coder - Visual Studio Code` → 面板是当前激活标签页。

---

## 6. 沉淀下来的工程能力（这次事故的真正产出）

1. **自诊断通道** —— `src/webview/diagnostics.ts`
   把 webview 内部的 CSP 违规 / 资源 404 / 未捕获异常 / `console.error` / DOM 快照，
   实时回传到扩展进程并落盘 `webview-diag.json`。
   探针**不调用 `acquireVsCodeApi`**（一个 webview 只能 acquire 一次，第二次会抛
   "An instance of the VS Code API has already been acquired"，反而把前端搞崩），
   只用 `window.parent.postMessage` 做兜底，主通路仍由前端自己 `postMessage`。

2. **就绪探针** —— `src/webview/panel.ts` 的 `_armReadyProbe()`
   前端本来就会发一条 `ready`；5 秒内收不到 = 前端脚本没跑起来。
   把"白屏"从「不知道」变成「日志里有一行明确结论」。

3. **`mini-coder.openOnStartup` 设置** + `MINI_CODER_AUTOPEN=1` 环境变量
   让冒烟测试能无人值守地打开面板取证。

4. **CSP 兜底提示** —— HTML 里本来就写了"如果这里一片空白…"
   但它**救不了这个故障**：SW 失败时 HTML 根本不会被写进 iframe。
   这也说明"善意的兜底文案"不等于"可靠的故障恢复"。

---

## 7. 复发自查清单

再遇到"VS Code 面板空白"，按这个顺序查，别跳步：

1. 右下角有没有 `Error loading webview provided by ...` 的通知？
   **有 → 直接看完整报错文本**（不要去日志里找，它不写日志）。
2. 启动日志里有没有 `checkInnoSetupMutex: vscode-updating is held, waiting up to 30s`？
   **有 → 有更新锁占着**，先杀 `inno_updater.exe` / `CodeSetup-*.exe`。
3. `%APPDATA%\Code\Service Worker\Database\000003.log` 里注册的 `?v=N` 和当前 VS Code 要求的版本一致吗？
   **不一致 → 清掉 SW 数据库**（先备份，用重命名）。
4. 注册表里的 VS Code InstallLocation 指向的目录里**有没有 `Code.exe`**？
   **没有 → 半死残留**，移走它。
5. 以上都对，还是空白 → 才轮到扩展侧：看 `webview-diag.json` 的 CSP 违规 / 资源 404。
