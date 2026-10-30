# 🐣 vscode-mini-coder 白话版路线图（配代码）

> 这份文档是 `docs/archive/ROADMAP_V3.md` 的**入门版**。那一版信息密度太高，这份用大白话讲。
> 配套代码**可以直接抄进你的项目**。
> 生成时间：2026-10-27
> **数字更新：2026-10-29** —— 文中所有"当前状态"类数字都按实测重新核对过
> （提交数看 `git log origin/master..HEAD`，CI job 数看 `.github/workflows/ci.yml`，
> 评测数字看 `eval/RESULTS.md`，成本口径 = 30 题全量那次）。

---

## 目录

1. [一句话总结](#一-一句话总结)
2. [你现在的处境（一个比喻）](#二-你现在的处境一个比喻)
3. [五个问题，用生活讲](#三-五个问题用生活讲)
4. [好消息：最难的地基你已经打好了](#四-好消息最难的地基你已经打好了)
5. [接下来 6 周：三张卡片](#五-接下来-6-周三张卡片)
6. [代码（全部带注释，可直接抄）](#六-代码全部带注释可直接抄)
7. [今天下午就能做完的 3 件事](#七-今天下午就能做完的-3-件事)

---

## 一、一句话总结

> **你造了一台很棒的车 —— 2026-10-28 / 10-29 这两天，车已经开出去了：**
> **钥匙插上了（只剩 1 个提交没推）、保险买好了（CI 4 个 job 全绿）、车牌上好了（v0.5.0 已发布）、
> MCP 涡轮也装上了（stdio 客户端，6 个源文件 / 36 个测试）。**
>
> **接下来 6 周就干一件事：**
> **造几条别人抄不走的证据（Recipe / 录播放 / 真实项目实操）+ 作用域审批。**

---

## 二、你现在的处境（一个比喻）

假设你做了一台手工引擎的车：

| 你造好的部分 | 对应项目里的东西 | 状态 |
|---|---|---|
| 底盘、涡轮、变速箱 | Agent 主循环、11 个工具、协议自愈 | ✅ 全绿 |
| 试车跑道 + 秒表 + 消融实验 | 30 题评测集 + 方差统计 + 消融 | ✅ 有 |
| 维修手册 | ARCHITECTURE.md | ✅ 有 |
| 车钥匙 | **只剩 1 个提交没推** | ⚠️ **还差最后一下** |
| 交强险（CI） | **`.github/workflows/ci.yml`**（4 个 job 全绿） | ✅ **生效了** |
| 车牌 + 上路证 | **GitHub Release = v0.5.0** | ✅ **有** |
| 涡轮发动机（MCP） | **stdio 客户端，6 个源文件 / 36 个测试** | ✅ **装上了** |

**你的技术能力早就够了。问题 100% 出在"最后一公里"。**

> 面试官不会 clone 你的仓库跑 638 个测试。
> 他只会**点一下你简历里的链接，看一眼 GitHub 首页**。
> 现在那个首页停在 10 月 23 日，CI 徽章是灰的，Releases 写着 "0"。
> **第一印象就死在这儿了。**

---

## 三、五个问题，用生活讲

### 问题 1：只剩 1 个提交没推

**比喻**：你写了 21 页论文，存自己电脑里了，现在只剩最后 1 页没发出去。

**事实**：
```
$ git log origin/master..master
001e681 chore(repo): 收尾整理 —— 4 份路线图合并为 1 份 + 清理冗余文件
```

前面 **56 个提交**已经在 2026-10-28 推上去了（`origin/master` 现在就比本地少这 1 条）。

**你还没推的那 1 个提交里有什么**：4 份路线图合并成 1 份 + 清理冗余文件。

**这一条推完，车就彻底开出去了。**

---

### 问题 2 + 3：CI 从没跑过（而且修好之前也不会跑）

**这是两个 bug 叠在一起**，我实测确认的：

**Bug A：配置文件写错了分支名**

```yaml
# .github/workflows/ci.yml 第 39-42 行（你现在的样子）
on:
  push:
    branches: [main]      # ❌ 你的仓库默认分支是 master！
  pull_request:
    branches: [main]      # ❌
```

**Bug B：所以它一次都没被触发过**

```
$ curl https://api.github.com/repos/Yg-ui555/vscode-mini-coder/actions/runs
{"total_count": 0, "workflow_runs": []}     ← 一次都没有
```

> ✅ **已解决（2026-10-28）**：分支名改对之后，CI 第一次跑起来就暴露了 5 个 CI 配置问题
> ——`job` 级 `if` 用了 `secrets` 上下文（GitHub 直接拒绝加载整个 workflow 文件）、
> 4 个 ubuntu-only 失败（快照的路径分隔符、断言里写死的 Windows 绝对路径）、
> `eval smoke` 找不到 API Key（只读 `.env` 不读 `process.env`）。
> 全部修完后：**4 个 job（test / guard / eval-smoke / package）全绿**，CI 徽章第一次变成绿的。
>
> **教训**：CI 从"没跑过"到"跑起来"之间，还隔着"跑起来之后它是红的"。
> 前者只花 10 分钟，后者花了一整天。

**比喻**：你在门口装了个"自动开门感应器"，但**接错线了**，
而且**你从来没按过那个开关**（你一直是手动跑测试的）。

**所以你 README 上这个徽章**：

```markdown
[![CI](https://github.com/Yg-ui555/vscode-mini-coder/actions/workflows/ci.yml/badge.svg)]
```

**现在是绿的。** 而 CI 徽章是简历上**最不值钱也最致命**的装饰——
它本身不说话，但面试官会看。

---

### ✅ 问题 4：GitHub Release = 0（已解决 2026-10-28）

```
$ curl https://api.github.com/repos/Yg-ui555/vscode-mini-coder/releases
[{"tag_name": "v0.5.0", "assets": [{"name": "vscode-mini-coder-0.5.0.vsix"}]}]
```

已发布 **v0.5.0**，附 VSIX 安装包（约 450 KB / 104 个文件）。

**比喻**：你车修好了，也贴了贴纸，这次**真去车管所上牌了**。

**面试现场**：
> 面试官："你说你发布了 v0.5.0？"
> 你：（点开链接，**400+ KB 的安装包直接下载**）

---

### ✅ 问题 5：topic 写着 mcp，但代码里没有 MCP（已解决 2026-10-29）

**当时的诊断**（2026-10-27）：
```
$ grep -ri "mcp" src/ | wc -l
2        # ← 2 处误命中（不是真实现）
```

**现在**：
```
$ ls src/agent/mcp/
config.ts  manager.ts  mcpTool.ts  protocol.ts  schemaNormalize.ts  stdioClient.ts

$ npx vitest run src/__tests__/mcp
 Test Files  3 passed (3)
      Tests  36 passed (36)
```

**MCP stdio 客户端已经做完并接进 agent 管线了：6 个源文件 / 1,317 行 / 36 个单元测试。**
当初选的"3 天后真的把它做出来"这条路，走完了。

**三个关键设计**（细节见 `README.md` 的「⭐ MCP：接入外部工具生态」一节）：

| 设计 | 为什么这么定 |
|---|---|
| 工具名带命名空间 `mcp__<服务器>__<工具>` | 两个服务器都提供 `read_file` 时不撞名；而且 `mcp__` 前缀就是**信任边界** —— 一律按"外部程序"处理，不会因为名字长得像内置只读工具就被自动放行 |
| 权限读服务器自带的 `annotations.readOnlyHint` | 声明了只读就自动放行 + 允许并行；**没声明就按"写"处理**（每次调用都要用户点头）—— 黑盒不可信，一律先问 |
| 一个服务器挂掉不影响其他的 | 启动失败只记警告、跳过该服务器，其余工具照常工作（"外卖少点一家，不影响吃饭"） |

**为什么值得单独做**：MCP 的坑**全是静默失败** —— 不报错，只是让 AI 偶尔传错参数。
`$ref` 引用、`type: ["string","null"]`、`oneOf`、stdout 混进日志、stderr 接到 stdout、
Windows 路径含空格 —— 每一个都有专门的归一化处理和测试。

**比喻**：你的名片上印着"精通焊接"，现在手上有焊渣了 —— 而且是**不接错线的**那种焊渣。

---

## 四、好消息：最难的地基你已经打好了

这是我这趟**最想让你知道的事**。

我原本以为 MCP 接入要大改架构。**读完你的代码我发现：不用改。**

### 证据 1：工具清单是每轮实时算的

```typescript
// src/agent/operations/inference.ts:65
for await (const chunk of ctx.provider.stream(modelMessages, ctx.registry.schemas, ctx.signal)) {
//                                                              ^^^^^^^^^^^^^^^^^^^^^
//                                    每次调 LLM 都重新读一遍 registry.schemas
```

**这意味着**：MCP 服务器在**运行时**才吐出工具（因为它是个独立进程，
要启动、要握手、要问它有哪些工具），但你的架构**天然支持**——
**下一轮 LLM 调用自动就带上新工具了，不用重启对话。**

### 证据 2：注册表可以运行时注册

```typescript
// src/agent/tools/registry.ts:24
register(tool: Tool): void {
  this.tools.set(tool.name, tool);
}
```

公开方法，随便调。

### 证据 3：连"协议一致性"都做好了

```typescript
// src/agent/operations/toolExecution.ts:99-108
// ⭐ 过滤掉"本轮没广告过"的工具
//
//   ⚠️ 协议合法性：assistant 声明了 N 个 tool_call，就必须紧跟 N 条 tool 消息。
//   所以被过滤掉的那些【也要补一条 tool 消息】（内容是"没执行"），
//   不能直接丢掉 —— 丢了下一轮就是 400。
const advertised = ctx.state.advertisedTools;
const isAdvertised = (n: string): boolean => {
  if (!advertised) return true;
  return advertised.includes(n);
};
```

**这段代码 = goose 的铁律**（`crates/goose-agent/src/tool.rs:119-122`：
*"工具名从广告出去到所有调用处理完，必须保持稳定"*）。

**也就是说**：MCP 服务器中途崩了、工具被下架了 —— 你这套机制**已经能兜住**。

### 所以 MCP 到底难在哪？

难的不是"架构要不要改"，而是"**协议细节对不对**"。

> **比喻**：造一台能装涡轮的车，最难的是底盘和传动系 —— **你造好了**。
> 现在只要**把涡轮装上去**（写个 MCP 客户端），动力就来了。
>
> 而且涡轮只有一种（stdio），不是 nanobot 那一整套
> （stdio + HTTP + SSE + OAuth + SSRF 防护 + 7 家 provider 的 schema 归一化）。

**工作量：4 个新文件，约 720 行，3 天。**
**（当时的估算 —— 实际落地是 6 个源文件 / 1,317 行 / 36 个测试，
比预估多，是因为 MCP 的坑全是静默失败，每一个都得单独立测试。）**

---

## 五、接下来 6 周：三张卡片

### 🩹 卡片 1：Phase 9 止血（W0，1~2 天）

**这一张卡的回报最大，因为成本最低。**

- [x] 修 CI 分支名 → 推送提交（已推 56 条，**还剩 1 条**）
- [x] **确认 CI 真跑了**（看 Actions 日志，不只看徽章）—— 2026-10-28 首次全绿
- [x] 重跑 30 题评测（**≈¥7.32**，实测 908.9s）
- [x] 校正 README 里的数字（9→11 个工具、23→30 题）
- [x] 发 GitHub Release v0.4.1
- [x] 写 `AGENTS.md`
- [x] **配置链路重写成单一真相源 + `/doctor` 真打接口**（v0.5.0，2026-10-29）
  —— 起因是插件报「配额不足」而日志写「余额用完」，
  两边对不上；顺手挖出 `.env` 读错目录、优先级写反、外家 key 顶替三个静默 bug

### 🚀 卡片 2：Phase 10 补入场券（W1~W3）

- [x] **MCP 客户端**（stdio，**6 个源文件 / 1,317 行 / 36 个测试**）—— 2026-10-29 完成
- [x] **AGENTS.md 自动加载**（`src/agent/context.ts` 的 `BOOTSTRAP_FILES`）
- [ ] **作用域审批**（"总是允许"绑定到具体命令）
- [x] **动态工具收尾**（`ContextBuilder` 按实际注册的工具裁剪 prompt，工具多了不会撑爆）

### 🏆 卡片 3：Phase 11 造证据（W4~W6）

- [ ] **Recipe**（YAML 工作流，10 道题迁移过去）
- [ ] **录/回放**（CI 从此零成本跑完整 30 题）
- [x] **评测恢复刻度**（pass rate 落到 **93%** —— 2026-10-27 实测 28/30，
      23 题版的 100% 饱和被打破了，尺子重新有区分度）
- [x] **真实项目实操**（2026-10-25 `npm run audit` 审一个真实中型项目，
      27 轮 / 55 次工具调用 / 0 写入，当场挖出 4 个真 bug）
- [ ] **Marketplace 发布**（让真人用起来）

---

## 六、代码（全部带注释，可直接抄）

> 以下代码**对得上你项目的真实接口**：
> `Tool` 接口（`src/agent/tools/base.ts`）、
> `ToolMeta` / `readOnlyMeta`（`src/agent/tools/meta.ts`）、
> `ToolRegistry`（`src/agent/tools/registry.ts`）。

### 6.1 修 CI（5 分钟，最高性价比）

**改 `.github/workflows/ci.yml` 第 39-42 行**：

```yaml
# ❌ 改之前（你的现状）—— 写的是 main，但你的分支是 master
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

# ✅ 改之后
on:
  push:
    branches: [master]     # ← 你的仓库默认分支（origin/HEAD 指向 master）
  pull_request:
    branches: [master]
```

**顺便看一眼 `concurrency`**（你已经有了，但定时任务要单独一个组）：

```yaml
concurrency:
  # 定时评测和手动 push 不能互相取消！
  # 如果都用同一个 group，推送时会把凌晨的评测任务取消掉。
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'push' }}
  #                                            ↑ 只有 push 才取消，
  #                                            定时任务和 PR 不取消
```

### 6.2 推送 + 验证（照着抄）

```powershell
cd <你的项目目录>

# 1) 推代码 + 标签
git push origin master --follow-tags

# 2) 确认推干净了（应该没有任何输出）
git log origin/master..master --oneline

# 3) 看 CI 跑没跑（等 2 分钟再查）
curl.exe -s https://api.github.com/repos/Yg-ui555/vscode-mini-coder/actions/runs | Select-String "status|conclusion"
```

**⚠️ 一定要做"故意弄红"这一步**（很多人的 CI 配了但从没验证过）：

```powershell
# 故意写一个失败的测试
Add-Content src\__tests__\setup.ts "`ndescribe('故意失败验证CI', () => { it('应该红', () => { expect(1).toBe(2); }); });"

git add -A
git commit -m "test: 故意弄红，验证 CI 真的在跑"
git push origin master

# → 去 https://github.com/Yg-ui555/vscode-mini-coder/actions 看，它应该变红
# → 确认变红后，撤销：
git revert --no-edit HEAD
git push origin master
```

> **为什么必须做**：徽章变绿可能是缓存、可能是别的 job。
> **只有"故意弄红 → 确实变红"才能证明 CI 真的在工作。**
> 你自己 README 里写过这句话，我再强调一次。

### 6.3 MCP 客户端 · 第 1 个文件：JSON-RPC 协议（`src/agent/mcp/protocol.ts`）

```typescript
/**
 * MCP 的通信协议 —— JSON-RPC 2.0
 *
 * 大白话：MCP 服务器就是一个外部程序。
 * 我们往它的"输入管道"（stdin）写一行 JSON，它从"输出管道"（stdout）吐一行 JSON。
 * 跟 HTTP 无关，就是两个进程用管道说话。
 *
 * 协议就三句话：
 *   1. initialize        —— 握手："你好，我支持啥功能？"
 *   2. tools/list        —— "你有哪些工具？给我看看说明书"
 *   3. tools/call        —— "帮我用一下这个工具，参数是这些"
 *
 * 每条消息带一个 id，我们靠 id 把回答对回问题（因为应答可能乱序到达）。
 */

/** 一条请求（我们发给服务器） */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;              // 请求编号，用来对答案
  method: string;          // 方法名，比如 'tools/list'
  params?: any;            // 参数
}

/** 一条应答（服务器发回） */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;            // 成功时在这里
  error?: {                // 失败时在这里
    code: number;
    message: string;
  };
}

/** MCP 服务器可能抛回来的"通知"（不需要 id，我们不用管） */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

/** MCP 工具的说明书长这样（我们从 tools/list 拿到的） */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  /** 参数说明，是一份完整 JSON Schema（可能带 $ref / $defs，坑很多） */
  inputSchema?: Record<string, any>;
  /**
   * ⭐ MCP 规范自带的标注：
   *   readOnlyHint: true 表示这个工具不会改东西。
   *   我们直接白嫖它 —— 这样 MCP 只读工具能自动放行，不用问用户。
   */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}
```

### 6.4 MCP 客户端 · 第 2 个文件：启动服务器 + 收发消息（`src/agent/mcp/stdioClient.ts`）

```typescript
/**
 * MCP stdio 客户端 —— 启动一个外部程序，跟它对话
 *
 * 大白话：
 *   1. spawn 一个子进程（比如 npx @modelcontextprotocol/server-filesystem）
 *   2. 往它的 stdin 写 JSON（一行一条）
 *   3. 从它的 stdout 读 JSON（一行一条）
 *   4. 用 id 把回答对回问题
 *
 * 坑：
 *   - stdout 里可能混进"日志"（不是 JSON），要能跳过
 *   - 服务器可能起不来（命令不存在 / 报错），要能优雅失败
 *   - stderr 要单独吃掉，不然会堵住管道（子进程缓冲区满了会卡死）
 */

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import {
  JsonRpcRequest,
  JsonRpcResponse,
  McpToolDescriptor,
} from './protocol';

/** 一条待处理的请求 */
interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface McpServerConfig {
  /** 服务器名字，用来拼工具名：mcp__<name>__<tool> */
  name: string;
  /** 可执行文件，比如 'npx' */
  command: string;
  /** 参数，比如 ['-y', '@modelcontextprotocol/server-filesystem', '/path'] */
  args: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 单次请求超时（毫秒） */
  timeoutMs?: number;
}

export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  /** 等待回答的请求：id → 回调 */
  private pending = new Map<number, Pending>();
  /** stdout 的残留 buffer（半行 JSON 要留着等下一段） */
  private buffer = '';

  constructor(private readonly config: McpServerConfig) {}

  /**
   * 启动服务器并完成握手
   *
   * 握手要三步，顺序不能错：
   *   1. 发 initialize，服务器回它的能力（capabilities）
   *   2. 发 notifications/initialized（通知，没有 id，不需要回答）
   *   3. 之后才能开始 tools/list
   */
  async start(): Promise<void> {
    await this.spawnProcess();

    // 第 1 步：握手
    const init = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },      // 告诉它"我要用工具"
      clientInfo: { name: 'vscode-mini-coder', version: '0.4.0' },
    });

    // 第 2 步：通知它"我准备好了"（通知没有 id，服务器不会回）
    this.notify('notifications/initialized', {});

    // 第 3 步：拉工具清单
    const list = await this.request('tools/list', {});
    this.tools = (list?.tools ?? []) as McpToolDescriptor[];
  }

  private tools: McpToolDescriptor[] = [];

  /** 拿到这个服务器提供的所有工具 */
  getTools(): McpToolDescriptor[] {
    return this.tools;
  }

  /**
   * 启动子进程
   *
   * ⚠️ Windows 注意：stdio 里用 shell:true 有安全风险（参数不转义），
   *    而且 Windows 的 .cmd 脚本需要 shell 才能跑。
   *    这里跟 run_shell.ts 的处理保持一致。
   */
  private spawnProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.command, this.config.args, {
        env: { ...process.env, ...(this.config.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',   // Windows 上 npx 是 .cmd，需要 shell
      });

      this.child = child;

      // ── 读 stdout：这里出来的才是正经 JSON ──
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        this.buffer += chunk;

        // 按行切分。一行一条 JSON，这是 JSON-RPC over stdio 的规矩。
        const lines = this.buffer.split('\n');
        // 最后一段可能是半条（还没收全），留在 buffer 里等下一段
        this.buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let msg: JsonRpcResponse;
          try {
            msg = JSON.parse(trimmed);
          } catch {
            // 有些服务器会往 stdout 打日志（不是 JSON）。
            // 忽略就行，千万别崩 —— 一个杂音不该搞死整个 agent。
            continue;
          }

          // 按 id 把回答对回问题
          const waiter = this.pending.get(msg.id);
          if (!waiter) continue;      // 迟到的回答（比如超时后才回来），丢掉

          clearTimeout(waiter.timer);
          this.pending.delete(msg.id);

          if (msg.error) {
            waiter.reject(new Error(`MCP 错误 ${msg.error.code}: ${msg.error.message}`));
          } else {
            waiter.resolve(msg.result);
          }
        }
      });

      // ── 读 stderr：只是防止管道堵住，内容不关心 ──
      //    ⚠️ 千万别把 stderr 接到 stdout！有些服务器把日志打到 stderr，
      //       混进 stdout 会让 JSON 解析失败。
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', () => {
        /* 吃掉就好，防止 stderr 缓冲区满了把子进程卡死 */
      });

      // ── 出错处理 ──
      child.on('error', (err: Error) => {
        // 典型原因：命令不存在（ENOENT）
        this.rejectAllPending(new Error(`MCP 服务器 "${this.config.name}" 启动失败: ${err.message}`));
        reject(err);
      });

      child.on('exit', (code) => {
        this.rejectAllPending(
          new Error(`MCP 服务器 "${this.config.name}" 意外退出（code=${code}）`),
        );
        this.child = null;
      });

      // 给一点启动时间，让它把初始化做完
      setTimeout(resolve, 50);
    });
  }

  /**
   * 发一条请求，等它的回答
   *
   * 用 id 配对 + 超时兜底。超时了要把 id 从 pending 里删掉，
   * 否则会永远泄漏。
   */
  private request(method: string, params: any): Promise<any> {
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timeoutMs = this.config.timeoutMs ?? 30_000;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时（${timeoutMs}ms）: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      // 写出去。注意结尾要加 '\n' —— 这是 stdio 传输的分帧方式
      this.child?.stdin.write(JSON.stringify(msg) + '\n');
    });
  }

  /** 发一条通知（没有 id，服务器不回答） */
  private notify(method: string, params: any): void {
    const msg = { jsonrpc: '2.0', method, params };
    this.child?.stdin.write(JSON.stringify(msg) + '\n');
  }

  /** 调用服务器上的某个工具 */
  async callTool(name: string, args: any): Promise<string> {
    const result = await this.request('tools/call', { name, arguments: args });

    // MCP 的结果格式：{ content: [{ type: 'text', text: '...' }] }
    // 可能有多个 content 块，拼起来
    const content = result?.content ?? [];
    return content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
  }

  /** 服务器挂了，所有等待中的请求都要失败掉，不能让他们干等 */
  private rejectAllPending(err: Error): void {
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.pending.clear();
  }

  /** 关闭服务器（扩展停用时必须调用，否则会留下孤儿进程） */
  async stop(): Promise<void> {
    if (!this.child) return;
    try {
      this.child.stdin.end();
      this.child.kill();
    } catch {
      /* 已经死了就算了 */
    }
    this.child = null;
  }
}
```

### 6.5 MCP 客户端 · 第 3 个文件：schema 归一化（`src/agent/mcp/schemaNormalize.ts`）

```typescript
/**
 * 把 MCP 的参数说明，翻译成"各大 LLM 后端都认"的扁平格式
 *
 * 为什么必须做（这是 nanobot 花了几百行踩坑总结出来的）：
 *
 *   MCP 传的是【完整 JSON Schema】—— 能带 $ref、$defs、oneOf、anyOf。
 *   但很多 OpenAI 兼容后端（DeepSeek / MiniMax / 一些自建网关）
 *   【只认扁平的】。
 *
 *   后果不是"调用失败"这么简单 —— 是模型看到一份后端不认的说明，
 *   【自己瞎猜参数】，然后传一个错的给你。
 *   轻则报错，重则执行了错误的东西。
 *
 * 我们处理 4 类：
 *   1. $ref: "#/$defs/Foo"      → 直接内联展开
 *   2. type: ["string","null"]  → type:"string" + nullable:true
 *   3. oneOf                    → 降级成 anyOf
 *   4. 递归引用（自己引用自己） → 断链，防止无限展开
 */

export function normalizeSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }

  // 用 WeakSet 记住"正在处理中"的对象，防止自引用无限递归
  const seen = new WeakSet<object>();
  return walk(schema, seen);
}

function walk(node: any, seen: WeakSet<object>): any {
  if (!node || typeof node !== 'object') return node;

  // ⭐ 自引用保护：A 引用 A，展开它就会无限循环
  if (seen.has(node)) {
    return { type: 'object', description: '（递归引用，已截断）' };
  }
  seen.add(node);

  // ── 情况 1：$ref 内联展开 ──
  // MCP 常写：{ "$ref": "#/$defs/PathInput" }
  // 但 $defs 里的定义在同一份 schema 的顶层，我们拿不到上下文，
  // 所以这里做不了真正的内联 —— 保守做法：转成宽松的 object。
  //
  // ⚠️ 真实项目里更好的做法：把整个 schema 的 $defs 传进来一起解析。
  //    这里先给一个安全版本，保证不会让模型传出畸形参数。
  if (node.$ref) {
    return {
      type: 'object',
      description: node.description ?? '（参数结构由 MCP 服务器定义，请参考工具说明）',
    };
  }

  // ── 情况 2：type 数组 → nullable ──
  // { "type": ["string", "null"] } → { "type": "string", "nullable": true }
  let out: any = { ...node };

  if (Array.isArray(node.type)) {
    const types = node.type.filter((t: string) => t !== 'null');
    out.type = types[0] ?? 'string';
    if (types.length !== node.type.length) {
      out.nullable = true;      // 原来允许 null，就标记出来
    }
  }

  // ── 情况 3：oneOf 降级成 anyOf ──
  // some 后端不认 oneOf，但认 anyOf。anyOf 语义更宽松，是安全降级。
  if (Array.isArray(node.oneOf)) {
    out.anyOf = node.oneOf.map((s: any) => walk(s, seen));
    delete out.oneOf;
  }
  if (Array.isArray(node.anyOf)) {
    out.anyOf = node.anyOf.map((s: any) => walk(s, seen));
  }

  // ── 递归处理子节点 ──
  if (node.properties && typeof node.properties === 'object') {
    out.properties = {};
    for (const [key, val] of Object.entries(node.properties)) {
      out.properties[key] = walk(val, seen);
    }
  }
  if (node.items) {
    out.items = walk(node.items, seen);
  }
  if (Array.isArray(node.required)) {
    out.required = node.required;     // required 是字符串数组，原样保留
  }

  return out;
}
```

### 6.6 MCP 客户端 · 第 4 个文件：包装成 mini-coder 的工具（`src/agent/mcp/mcpTool.ts`）

```typescript
/**
 * 把 MCP 服务器上的一个工具，包装成 mini-coder 的 Tool
 *
 * 大白话：LLM 只认 mini-coder 的 Tool 接口。
 * MCP 的工具长得不一样，所以要套一层"翻译服"，
 * 让 LLM 以为它就是个普通工具。
 */

import { Tool, ToolResult } from '../tools/base';
import { readOnlyMeta, execMeta, ToolMeta } from '../tools/meta';
import { McpStdioClient } from './stdioClient';
import { normalizeSchema } from './schemaNormalize';

export class McpTool implements Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, any>;
  readonly meta: ToolMeta;

  constructor(
    private readonly client: McpStdioClient,
    private readonly serverName: string,
    private readonly tool: { name: string; description?: string; inputSchema?: any },
  ) {
    // ⭐ 工具名必须带命名空间
    //    格式：mcp__<服务器名>__<工具名>
    //    理由一：防止和内置工具重名（两个都叫 read_file 就乱了）
    //    理由二：模型一眼看出这个工具来自哪个服务器
    //    理由三：你现有的 registry.resolveAlias() 已经支持这种带前缀的名字，
    //            它会把 mcp__fs__read_file 的最后一段拿出来匹配 —— 免费的兼容
    this.name = `mcp__${serverName}__${tool.name}`;

    this.description =
      (tool.description ?? '') +
      `\n\n（这是 MCP 服务器 "${serverName}" 提供的工具）`;

    // 参数说明翻译成后端认的格式
    this.parameters = normalizeSchema(tool.inputSchema ?? {});

    // ⭐ 权限判定：白嫖 MCP 规范自带的 readOnlyHint
    //    服务器自己说"我只读" → 按只读处理（自动放行 + 允许并行）
    //    没说               → 按最严格处理（每次都问用户）
    //
    //    ⚠️ 为什么默认最严：MCP 服务器是外部程序，它返回的内容一律不可信。
    //       你已经有一条很好的信任边界（<untrusted_content> 标记），
    //       权限上也应该保守。
    const readOnly = tool.annotations?.readOnlyHint === true;
    this.meta = readOnly
      ? readOnlyMeta(true)
      : execMeta(false);   // 不给并发（外部程序可能扛不住并发）
  }

  async execute(args: any): Promise<ToolResult> {
    try {
      const text = await this.client.callTool(this.tool.name, args ?? {});
      return { content: text };
    } catch (e: any) {
      // ⭐ 不要把异常抛出去 —— 抛出去整个 agent 循环就挂了
      //    返回 isError，让 LLM 看到错误后自己换策略
      return {
        content:
          `MCP 工具 ${this.name} 执行失败: ${e?.message || e}\n\n` +
          `[请分析上面的错误并换一个不同的做法，不要原样重试同样的参数]`,
        isError: true,
      };
    }
  }
}
```

### 6.7 MCP 管理器：把工具注册进你的注册表（`src/agent/mcp/manager.ts`）

```typescript
/**
 * MCP 服务器管理器
 *
 * 大白话：管好几个 MCP 服务器，把它们的工具都注册进你的 ToolRegistry。
 *
 * ⭐ 最重要的设计原则：【一个服务器挂掉，不能影响其他的】
 *   比喻：外卖少点一家，不影响吃饭。
 *   不能因为一个第三方服务器起不来，整个 agent 就瘫痪了。
 */

import { ToolRegistry } from '../tools/registry';
import { McpStdioClient, McpServerConfig } from './stdioClient';
import { McpTool } from './mcpTool';
import { warn } from '../../logger';

export class McpManager {
  private clients = new Map<string, McpStdioClient>();

  /**
   * 启动所有服务器，把工具注册进 registry
   *
   * @param configs 服务器配置列表
   * @param registry 你的工具注册表
   */
  async startAll(configs: McpServerConfig[], registry: ToolRegistry): Promise<void> {
    for (const cfg of configs) {
      try {
        const client = new McpStdioClient(cfg);
        await client.start();
        this.clients.set(cfg.name, client);

        // 把这个服务器的工具全部注册进去
        for (const t of client.getTools()) {
          registry.register(new McpTool(client, cfg.name, t));
        }

        console.log(`[MCP] 服务器 "${cfg.name}" 启动成功，${client.getTools().length} 个工具`);
      } catch (e: any) {
        // ⭐ 关键：记个警告，继续下一个
        //    绝对不能 throw —— 一个服务器挂了就全瘫，是很蠢的设计
        warn(`[MCP] 服务器 "${cfg.name}" 启动失败（已跳过，不影响其他工具）: ${e?.message || e}`);
      }
    }
  }

  /** 扩展停用时调用，清理所有子进程 */
  async stopAll(): Promise<void> {
    for (const [, client] of this.clients) {
      await client.stop();
    }
    this.clients.clear();
  }
}
```

### 6.8 配置文件（`.vscode/mini-coder-mcp.json`）

```jsonc
{
  // 约定用哪个文件，VS Code 生态的老规矩，用户不用学新路径
  "servers": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"],
      "env": {}
    },
    {
      "name": "memory",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  ]
}
```

**这里有两个细节值得面试时讲**：

```typescript
// ⭐ 1. ${workspaceFolder} 变量替换
//    这是 VS Code 生态的标准写法，用户已经会用了。
//    绝对不要自己发明一套路径语法。

// ⭐ 2. 配置文件里的敏感信息不能进日志
//    复用你已有的脱敏层：src/agent/tools/redact.ts
```

### 6.9 作用域审批（`src/agent/approvals/store.ts`）

```typescript
/**
 * "总是允许" 白名单
 *
 * 大白话：现在你的插件是"每次跑命令都问用户"。
 *   这很烦，但安全。
 *
 * 用户其实想要的是："git status 这种无害的命令，别再问我了。"
 *
 * ⭐ 关键设计（借鉴 goose 的 permission_store.rs）：
 *   授权必须绑定到【具体的命令】，不是绑定到【工具名】。
 *
 *   比喻：现在的门禁卡 = 刷开整栋楼。
 *         你要的門禁卡 = 只对工位 3 号有效。
 *
 *   也就是说：用户批了 `git status`，
 *   不代表 `rm -rf` 也能免确认。
 *
 * 三个必须有的属性：
 *   1. 精确匹配（不是前缀匹配！）
 *   2. 会过期（TTL）—— 三个月前批的，早忘了
 *   3. 能撤销 —— 授权是累积的，只能加不能删是安全债务
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ApprovalEntry {
  /** 工具名，比如 'run_shell' */
  tool: string;
  /** 判定用：参数的哈希 */
  contextHash: string;
  /** 显示用：人能看懂的原文（用户要能看清自己批过什么） */
  readable: string;
  allowed: boolean;
  createdAt: string;
  /** 过期时间（ISO 字符串），null = 永不过期 */
  expiresAt: string | null;
}

export interface ApprovalFile {
  version: 1;
  entries: ApprovalEntry[];
}

const DEFAULT_TTL_DAYS = 30;

/**
 * 算上下文哈希
 *
 * ⚠️ 为什么用哈希而不是直接存命令原文来匹配？
 *    因为要能"看起来一样但实际不同"的情况区分开。
 *    哈希保证匹配是精确的，不会有"前缀碰巧一样"的问题。
 *
 *    但注意：光有哈希不够 —— 用户要能看懂自己批过什么，
 *    所以还要存一份 readable 原文（只在 UI 里显示，不参与匹配）。
 */
export function hashContext(tool: string, context: string): string {
  return crypto
    .createHash('sha256')
    .update(`${tool}::${normalizeContext(context)}`)
    .digest('hex');
}

/**
 * 归一化：让"看起来一样"的命令算成同一个
 *
 * 目的是：用户第一次批了 "git status"，
 * 第二次 agent 调 "git  status"（多个空格）或者 "git status "（末尾空格），
 * 不应该又弹窗问一遍。
 */
export function normalizeContext(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/**
 * ⭐⭐ 核心安全逻辑：判断这条命令是不是在白名单里
 *
 * 【必须逐段精确匹配，不能前缀匹配】
 *
 * 为什么？看这个例子：
 *   白名单里有 "git status"
 *   agent 发来 "git status && rm -rf /"
 *
 *   如果做前缀匹配 → "git status" 是前缀 → 放行 → 💥 灾难
 *   如果做整串匹配 → 不匹配 → 正确拦下 ✅
 *
 *   但如果 agent 发来 "git status; rm -rf /"（分号），
 *   整串匹配也不匹配 → 也拦下了 ✅
 *
 * 那为什么要"逐段"？因为 agent 有时会发：
 *   "git status && npm test"
 * 如果两个都在白名单，应该放行（用户的本意就是都允许）。
 * 所以：拆成段 → 逐段查 → 全部在白名单才放行。
 */
export function isWhitelisted(
  entries: ApprovalEntry[],
  tool: string,
  context: string,
  now = new Date(),
): boolean {
  if (tool !== 'run_shell') return false;   // 目前只对命令生效

  const hash = hashContext(tool, context);
  const entry = entries.find((e) => e.contextHash === hash);
  if (!entry || !entry.allowed) return false;

  // 过期检查
  if (entry.expiresAt && new Date(entry.expiresAt).getTime() < now.getTime()) {
    return false;
  }

  return true;
}

/**
 * 拆分命令段
 *
 * 只处理常见的分隔符：&& || ; |
 * ⚠️ 这里是安全敏感代码，改动必须配套加测试。
 */
export function splitCommand(command: string): string[] {
  return command
    .split(/&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 判断整条命令链是否全部被允许
 */
export function isFullyWhitelisted(
  entries: ApprovalEntry[],
  command: string,
  now = new Date(),
): boolean {
  const parts = splitCommand(command);
  if (parts.length === 0) return false;

  // ⭐ 每一段都要单独在白名单里，缺一不可
  return parts.every((p) => isWhitelisted(entries, 'run_shell', p, now));
}

/**
 * 审批文件存储
 *
 * 位置：globalStorageUri（换仓库也保留 —— 用户的授权习惯不该因为换个项目就失效）
 */
export class ApprovalStore {
  constructor(private readonly filePath: string) {}

  load(): ApprovalFile {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { version: 1, entries: [] };
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as ApprovalFile;
      return parsed?.entries ? parsed : { version: 1, entries: [] };
    } catch {
      // 读不出来就当空的，绝不让授权存储的问题搞崩 agent
      return { version: 1, entries: [] };
    }
  }

  /**
   * 新增一条授权
   *
   * ⭐ 原子写：先写 .tmp 再 rename。
   *    比喻：写文件像换电池，不能换到一半断电。
   *    rename 在同一文件系统上是原子的，不会出现"写了一半"的坏文件。
   *    （goose 的 permission_store.rs:63 就是这么做的）
   */
  save(data: ApprovalFile): void {
    const tmp = this.filePath + '.tmp';
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  /** 加一条授权（覆盖同一条的） */
  add(tool: string, readable: string, ttlDays = DEFAULT_TTL_DAYS): ApprovalEntry {
    const data = this.load();
    const now = new Date();
    const entry: ApprovalEntry = {
      tool,
      contextHash: hashContext(tool, readable),
      readable,
      allowed: true,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlDays * 86400_000).toISOString(),
    };
    data.entries = data.entries.filter((e) => e.contextHash !== entry.contextHash);
    data.entries.push(entry);
    this.save(data);
    return entry;
  }

  /** ⭐ 撤销一条（UI 上"管理已授权"用） */
  remove(contextHash: string): void {
    const data = this.load();
    data.entries = data.entries.filter((e) => e.contextHash !== contextHash);
    this.save(data);
  }

  /** 清理过期的 */
  cleanupExpired(): void {
    const data = this.load();
    const now = Date.now();
    const before = data.entries.length;
    data.entries = data.entries.filter(
      (e) => !e.expiresAt || new Date(e.expiresAt).getTime() > now,
    );
    if (data.entries.length !== before) this.save(data);
  }
}
```

### 6.10 `AGENTS.md`（项目自己的说明书，1 小时）

```markdown
# AGENTS.md —— 给 AI 协作者的说明书

> 这个文件有两类读者：
> ① 别的 AI 工具（Cline / Copilot / Cursor）
> ② 第一次接触这个仓库的人类开发者
>
> 两者要的是同一份东西：**这个仓库的规矩**。

## 项目一句话

VS Code AI 编程助手。ReAct Agent 运行时 + 自研回归检测评测体系。TypeScript，零运行时依赖。

## 硬性规矩（违反了是 bug，不是风格问题）

**Rule 1：Agent 运行时层不许 import `vscode`。**
  为什么：同一份 AgentLoop 要能同时跑在 VS Code、评测沙箱、单元测试里。
  位置：src/agent/**
  怎么验证：不装 vscode stub 也能跑 `npm test`

**Rule 2：新增工具必须显式声明 meta。**
  为什么：权限档位靠 meta.readOnly 静态映射，声明错了就是越权。
  位置：src/agent/tools/*.ts
  怎么验证：npm run check 会检查 ALL_TOOL_NAMES 和注册表一致

**Rule 3：工具的 execute() 只管取数据，别在里面加安全声明。**
  为什么：信任边界在管线出口统一处理（<untrusted_content> 标记）。
        逐个工具包会漏掉 run_shell —— 第一版就是这么漏的。
  位置：src/agent/operations/toolExecution.ts

**Rule 4：src/agent/ 下别用模块级可变状态存跨轮数据。**
  为什么：评测时多题并发，模块级状态会串味。
  怎么做：跨步骤共享放 ctx.state。

**Rule 5：改了 agent 行为，必须重跑 npm run eval 并把 eval/results.json 一起提交。**
  为什么：这个项目卖的是"可验证"。没有评测数据 = 没有证据。

## 架构速览

（贴 ARCHITECTURE.md 那张 Mermaid 图）

## 怎么加一个新工具 / Operation / Provider

（贴 ARCHITECTURE.md 第 6 节，照着抄就行）

## 踩过的坑（别再踩）

- Windows 下 cmd.exe 报错是 GBK 编码，Node 按 UTF-8 解码会乱码
- 评测题文件必须保持 LF 换行，否则标准答案自己都跑不过
- 压缩上下文时，assistant(带 tool_calls) 和它后面的 tool 消息必须整体保护，不能拆散
- 有些 provider 不支持 stream_options，报错时要摘掉这个字段重试一次
- git 提交信息里的换行符在 Windows 上要用 LF，不然 git log 显示会很丑
```

### 6.11 录 / 回放（让 CI 零成本跑完整 30 题）

```typescript
/**
 * 录 / 回放 —— 让 agent 的测试变成确定性的
 *
 * 大白话：agent 的测试天生不确定。
 *   同样的输入，模型这次说 A、下次说 B（温度、模型版本、工具顺序都会影响）。
 *   所以：
 *     - 每次跑评测都要花钱（30 题全量 ≈¥7.32，单题均摊 ¥0.2441）
 *     - 每次结果都有点不一样 → 分不清"是我改好了"还是"这次运气好"
 *
 * 解决办法：把模型的回答录下来，之后用录像代替真人。
 *
 * 比喻：这就是"彩排"。
 *   第一次演出（录制）用真演员（真 LLM），
 *   之后每次彩排（回放）用录像 —— 效果完全一致，但不花钱、不看天气。
 *
 * goose 也有这个模式：crates/goose/tests/mcp_integration_test.rs
 */

import * as fs from 'fs';
import * as crypto from 'crypto';

/** 录下来的一段 */
interface Cassette {
  /** 匹配用的键 */
  key: string;
  /** 录下来的流式 chunk（跟你 provider.ts 里的 StreamChunk 一个形状） */
  chunks: any[];
}

export class Recorder {
  private cassettes: Cassette[] = [];

  constructor(private readonly path: string) {
    if (fs.existsSync(path)) {
      this.cassettes = JSON.parse(fs.readFileSync(path, 'utf8'));
    }
  }

  /**
   * ⭐ 匹配键
   *
   * ⚠️ 不能只用"第几次调用"当键！
   *    因为你改了代码之后，agent 跑的轮数会变，
   *    按序号匹配会全部错位（本来录的第 3 轮，现在第 3 轮是别的东西）。
   *
   * 正确做法：用"这一轮的输入特征"来匹配：
   *   消息条数 + 工具条数 + 最后一条用户消息的哈希
   * 这样即使多了一轮，也能对上正确的录像。
   */
  static makeKey(messages: any[], tools: any[]): string {
    const lastUser = [...messages].reverse().find((m: any) => m.role === 'user');
    const lastText = typeof lastUser?.content === 'string' ? lastUser.content : '';
    return crypto
      .createHash('md5')
      .update(`${messages.length}::${tools.length}::${lastText}`)
      .digest('hex');
  }

  /** 录制模式：记下这一段 */
  record(key: string, chunks: any[]): void {
    this.cassettes.push({ key, chunks });
  }

  /** 存盘 */
  flush(): void {
    fs.mkdirSync(require('path').dirname(this.path), { recursive: true });
    fs.writeFileSync(this.path, JSON.stringify(this.cassettes, null, 2), 'utf8');
  }
}

export class Player {
  private cassettes: Cassette[] = [];

  constructor(path: string) {
    if (fs.existsSync(path)) {
      this.cassettes = JSON.parse(fs.readFileSync(path, 'utf8'));
    }
  }

  /** 找到对应的录像 */
  find(key: string): Cassette | undefined {
    return this.cassettes.find((c) => c.key === key);
  }
}

/**
 * 怎么用（伪代码，实际接进 provider.ts）：
 *
 *   const mode = process.env.MINI_CODER_REPLAY === '1' ? 'replay' : 'live';
 *
 *   if (mode === 'live') {
 *     // 真调用，同时录下来
 *     const chunks = [];
 *     for await (const chunk of realProvider.stream(msgs, tools, signal)) {
 *       chunks.push(chunk);
 *       yield chunk;
 *     }
 *     recorder.record(Recorder.makeKey(msgs, tools), chunks);
 *   } else {
 *     // 回放
 *     const key = Recorder.makeKey(msgs, tools);
 *     const cassette = player.find(key);
 *     if (!cassette) throw new Error(`没有对应的录像: ${key}`);
 *     for (const chunk of cassette.chunks) yield chunk;
 *   }
 */
```

---

## 七、今天下午就能做完的 3 件事

> ✅ **这三件在 2026-10-28 / 10-29 都做完了。**
> 命令保留在这里，方便你照着再走一遍。

如果今天只有 3 小时，就做这三件（**按顺序**）：

### 1️⃣ 修 CI + 推送（30 分钟）✅ 已完成

```powershell
cd <你的项目目录>

# 改 .github/workflows/ci.yml 第 40 行和第 42 行：main → master
# 然后：
git push origin master --follow-tags
```

### 2️⃣ 重跑 30 题评测（20 分钟 + ¥7.32）✅ 已完成

```powershell
npm run eval
```

跑完打开 `eval/RESULTS.md`，看三件事：
- `total` 是不是 30（之前是 23）→ **实测 30**
- pass rate 是多少（如果还是 100%，说明 7 道新题是送分题，Phase 11 有活干）
  → **实测 93%（28/30）** —— 7 道新题不是送分题，尺子有区分度了
- 最贵的 3 道题是哪几道（成本大头）→ **44 / 42 / 45**（合计 ¥1.98，占总成本 27%）

### 3️⃣ 写 AGENTS.md（1 小时）✅ 已完成

照着 6.10 的模板改改，**用你自己代码里的真实内容**。
你的代码注释里全是好素材：
- `ARCHITECTURE.md` 的六个设计决策
- `approval.ts:24-32` 的"为什么不学 goose 的 LLM judge"
- `delegate.ts` 的三条铁律
- `historyRepair.ts` 的协议约束

---

## 最后

> **别再追功能数量了。**
>
> **你现在的项目，在"能不能被验证"这件事上得 0 分。**
> **花一天半把它变成 100 分，收益比再写 500 行代码大得多。**
>
> **MCP 也已经装上了（stdio，6 个源文件 / 36 个测试）——**
> **那是 2026 年 agent 岗的入场券，而你的地基本来就打好了。**
>
> **接下来该造的是"别人抄不走的证据"：Recipe / 录回放 / Marketplace。**

---

*所有数字均为实测（评测与成本按 2026-10-27 那次 30 题全量，提交数与 CI 按 2026-10-29 核对）｜配套代码对得上你项目的真实接口*
