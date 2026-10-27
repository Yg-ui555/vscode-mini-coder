/**
 * MCP stdio 客户端 —— 启动一个外部程序，跟它对话
 *
 * ─────────────────────────────────────────────────────────────
 * 大白话
 *
 *   1. spawn 一个子进程（比如 npx @modelcontextprotocol/server-filesystem）
 *   2. 往它的 stdin 写 JSON（一行一条）
 *   3. 从它的 stdout 读 JSON（一行一条）
 *   4. 用 id 把回答对回问题
 *
 * ─────────────────────────────────────────────────────────────
 * 三个真实的坑（都踩过）
 *
 *   坑 1【stderr 绝对不能接到 stdout】
 *     有些 MCP 服务器把日志打到 stderr。
 *     如果用 `stdio: ['pipe','pipe','pipe']` 但不小心把 stderr 接到 stdout，
 *     日志就会混进 JSON 流 → 解析失败 → 整个客户端看起来"服务器没响应"。
 *
 *     比喻：两支队伍共用一个对讲机频道，
 *     结果一队说的是"请让一下"，另一队以为是"执行拆除指令"。
 *
 *   坑 2【stdout 里可能有非 JSON 的日志】
 *     同样有服务器往 stdout 打自己的日志。
 *     解析失败就【跳过这一行】，不能崩 —— 一个杂音不该搞死整个 agent。
 *
 *   坑 3【Windows 上 npx 是 .cmd】
 *     直接 spawn('npx') 在 Windows 上会 ENOENT。
 *     需要 shell: true（跟 run_shell.ts 的处理保持一致）。
 *     ⚠️ shell:true 有命令注入风险，所以【参数必须是配置里写死的】，
 *        不接受任何来自工具调用的参数 —— 这一点由配置层保证。
 *
 * ─────────────────────────────────────────────────────────────
 * 超时与清理
 *
 *   · 每次请求都有超时（默认 30s），超时要把 id 从 pending 里删掉，
 *     否则 pending map 会永远泄漏。
 *   · 服务器退出时，所有等待中的请求要立刻失败 ——
 *     不能让他们干等到超时（那会白等 30 秒）。
 */

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import {
  JSONRPC_VERSION,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  McpToolDescriptor,
  McpToolsListResult,
  McpToolCallResult,
  McpInitializeResult,
  isResponse,
} from './protocol';

/** 一条待处理的请求 */
interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

/**
 * 一个 MCP 服务器的配置
 *
 * @param name     服务器名，用来拼工具名 mcp__<name>__<tool>
 * @param command  可执行文件，比如 'npx'
 * @param args     参数，比如 ['-y', '@modelcontextprotocol/server-filesystem', '/path']
 */
export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** 单次请求超时（毫秒），默认 30000 */
  timeoutMs?: number;
  /** 工作目录 */
  cwd?: string;
}

/** 默认请求超时 */
export const DEFAULT_MCP_TIMEOUT_MS = 30_000;

/**
 * 给参数加引号（只在走 cmd.exe 的分支用）
 *
 * ⚠️ cmd.exe 的引号规则跟 POSIX shell 不一样：
 *   - 内部引号要写两遍（"" 表示一个引号）
 *   - 特殊字符（& | < > ^）在引号里才是字面量
 *
 *   所以只给【含特殊字符或空格】的参数加引号，
 *   其余原样传 —— 少加引号比多加安全。
 */
function quoteForCmd(s: string): string {
  if (!s || !/[\s"&|<>()^]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * MCP stdio 客户端
 */
export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  /** 等待回答的请求：id → 回调 */
  private readonly pending = new Map<number, Pending>();
  /** stdout 的残留 buffer（半行 JSON 要留着等下一段） */
  private buffer = '';
  /** 该服务器提供的工具 */
  private tools: McpToolDescriptor[] = [];
  /** 服务器是否已经完成握手 */
  private ready = false;
  /** 进程退出后的错误原因（用于让后续调用快速失败而不是再等超时） */
  private deadReason: string | null = null;

  constructor(private readonly config: McpServerConfig) {}

  /** 服务器名 */
  get name(): string {
    return this.config.name;
  }

  /** 是否握手成功 */
  get isReady(): boolean {
    return this.ready;
  }

  /** 该服务器提供的工具清单 */
  getTools(): McpToolDescriptor[] {
    return this.tools;
  }

  /**
   * 启动服务器并完成握手
   *
   * 握手三步，顺序不能错：
   *   1. 发 initialize，服务器回它的能力（capabilities）
   *   2. 发 notifications/initialized（通知，没有 id，不需要回答）
   *   3. 之后才能开始 tools/list
   *
   * 比喻：进会议室要先握手、再落座、然后才能开始讨论。
   */
  async start(): Promise<void> {
    await this.spawnProcess();

    const init = (await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'vscode-mini-coder', version: '0.4.0' },
    })) as McpInitializeResult;

    // 第 2 步：通知服务器"我准备好了"（通知没有 id，服务器不会回）
    this.notify('notifications/initialized', {});

    // 第 3 步：拉工具清单
    const list = (await this.request('tools/list', {})) as McpToolsListResult;
    this.tools = Array.isArray(list?.tools) ? list.tools : [];

    this.ready = true;
  }

  /**
   * 启动子进程
   *
   * ⭐⭐ Windows 的引号地狱（本项目踩过）
   *
   *   直觉写法是 `shell: true`（因为 Windows 上 npx 是 .cmd，不走 shell 找不到）。
   *   但那样一来，命令和参数都要经过 cmd.exe 重新解析：
   *
   *     command = 'C:\Program Files\nodejs\node.exe'   ← 路径带空格
   *     → cmd.exe 看到 "C:\Program" 就报"不是内部或外部命令"
   *
   *   所以本项目采用【先直连、失败再退到 shell】：
   *     第一次：shell=false，直接 CreateProcess —— 没有引号问题
   *     第二次：只在 Windows 上、且直连失败（ENOENT）时，才用 cmd.exe
   *
   *   比喻：先自己开车（快、准），实在发动不了再借别人的车（慢、要系安全带）。
   *
   *   ⚠️ 走 shell 分支时，参数必须自己加引号 —— 见 quoteForCmd。
   */
  private async spawnProcess(): Promise<void> {
    const first = await this.trySpawn(false);
    if (first.ok) return;

    // 只有 Windows 上、且是"命令找不到"这类启动失败，才退到 cmd.exe
    if (process.platform === 'win32') {
      const second = await this.trySpawn(true);
      if (second.ok) return;
      throw second.error ?? first.error;
    }

    throw first.error;
  }

  /**
   * 尝试启动一次
   *
   * @param useShell 是否走 shell
   * @returns ok=true 表示进程已经起来了
   */
  private trySpawn(useShell: boolean): Promise<{ ok: boolean; error?: Error }> {
    return new Promise((resolve) => {
      const { command, args } = this.config;

      // 走 shell 分支时，Windows 的 cmd.exe 会重新解析整行 ——
      // 含空格 / 特殊字符的参数必须自己加引号。
      const spawnCommand = useShell ? quoteForCmd(command) : command;
      const spawnArgs = useShell ? args.map(quoteForCmd) : args;

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(spawnCommand, spawnArgs, {
          env: { ...process.env, ...(this.config.env ?? {}) },
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: this.config.cwd,
          shell: useShell,
          windowsHide: true,
        });
      } catch (e: any) {
        resolve({
          ok: false,
          error: new Error(
            `MCP 服务器 "${this.config.name}" 启动失败: ${e?.message || e}`,
          ),
        });
        return;
      }

      this.child = child;

      let spawnSettled = false;

      // 'spawn' 事件 = 进程成功起来了
      child.once('spawn', () => {
        if (spawnSettled) return;
        spawnSettled = true;

        // ── 读 stdout：这里出来的才是正经 JSON ──
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => this.onStdout(chunk));

        // ── 读 stderr：只是防止管道堵住，内容不关心 ──
        //    ⚠️ 千万别把 stderr 接到 stdout！（见文件头"坑 1"）
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', () => {
          /* 吃掉就好，防止 stderr 缓冲区满了把子进程卡死 */
        });

        // ── 意外退出（已经起来之后）──
        child.on('exit', (code, signal) => {
          this.deadReason = `MCP 服务器 "${this.config.name}" 已退出（code=${code}, signal=${signal}）`;
          this.ready = false;
          this.rejectAllPending(new Error(this.deadReason));
          this.child = null;
        });

        resolve({ ok: true });
      });

      // 'error' 事件 = 起不来（命令不存在、权限不足等）
      child.once('error', (err: Error) => {
        if (spawnSettled) {
          // 已经起来之后才报错 —— 说明运行期出问题了，让 pending 全部失败
          this.deadReason = `MCP 服务器 "${this.config.name}" 出错: ${err.message}`;
          this.rejectAllPending(new Error(this.deadReason));
          return;
        }
        spawnSettled = true;
        this.child = null;
        resolve({
          ok: false,
          error: new Error(
            `MCP 服务器 "${this.config.name}" 启动失败: ${err.message}`,
          ),
        });
      });
    });
  }

  /**
   * 处理 stdout 的一段数据
   *
   * 分帧规则：JSON-RPC over stdio 是【一行一条 JSON】。
   * 所以按 \n 切分，最后一段可能是半条（还没收全），留在 buffer 里等下一段。
   */
  private onStdout(chunk: string): void {
    this.buffer += chunk;

    const lines = this.buffer.split('\n');
    // 最后一段留到下一次（可能是半条 JSON）
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let msg: JsonRpcResponse | JsonRpcNotification;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        // 有些服务器会往 stdout 打日志（不是 JSON）。
        // 忽略就行，千万别崩 —— 一个杂音不该搞死整个 agent。
        continue;
      }

      // 通知（没有 id）—— 忽略。目前没实现 tools/list_changed 的响应。
      if (!isResponse(msg)) continue;

      // 按 id 把回答对回问题
      const waiter = this.pending.get(msg.id);
      if (!waiter) {
        // 迟到的回答（比如超时之后才回来）—— 丢掉
        continue;
      }

      clearTimeout(waiter.timer);
      this.pending.delete(msg.id);

      if (msg.error) {
        waiter.reject(
          new Error(
            `MCP 请求失败（${waiter.method}）: ${msg.error.code} ${msg.error.message}`,
          ),
        );
      } else {
        waiter.resolve(msg.result);
      }
    }
  }

  /**
   * 发一条请求，等它的回答
   *
   * 用 id 配对 + 超时兜底。超时了要把 id 从 pending 里删掉，否则会永远泄漏。
   */
  private request(method: string, params: unknown): Promise<unknown> {
    if (this.deadReason) {
      return Promise.reject(new Error(this.deadReason));
    }
    if (!this.child) {
      return Promise.reject(new Error(`MCP 服务器 "${this.config.name}" 未启动`));
    }

    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: JSONRPC_VERSION, id, method, params };

    return new Promise((resolve, reject) => {
      const timeoutMs = this.config.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时（${timeoutMs}ms）: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer, method });

      try {
        // 写出去。注意结尾要加 '\n' —— 这是 stdio 传输的分帧方式
        this.child!.stdin.write(JSON.stringify(msg) + '\n');
      } catch (e: any) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`MCP 写入失败: ${e?.message || e}`));
      }
    });
  }

  /**
   * 发一条通知（没有 id，服务器不回答）
   */
  private notify(method: string, params: unknown): void {
    const msg = { jsonrpc: JSONRPC_VERSION, method, params };
    try {
      this.child?.stdin.write(JSON.stringify(msg) + '\n');
    } catch {
      /* 写不进去就算了，通知不重要 */
    }
  }

  /**
   * 调用服务器上的某个工具
   *
   * @param name 工具名（服务器侧的名字，不带命名空间）
   * @param args 参数
   * @returns 工具返回的文本
   */
  async callTool(name: string, args: unknown): Promise<string> {
    const result = (await this.request('tools/call', {
      name,
      arguments: args ?? {},
    })) as McpToolCallResult;

    // MCP 的结果格式：{ content: [{ type: 'text', text: '...' }] }
    // 可能有多个 content 块，拼起来
    const content = Array.isArray(result?.content) ? result.content : [];
    const text = content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');

    if (result?.isError) {
      throw new Error(text || `MCP 工具 ${name} 返回了错误`);
    }
    return text;
  }

  /**
   * 服务器挂了，所有等待中的请求都要失败掉，不能让他们干等
   */
  private rejectAllPending(err: Error): void {
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.pending.clear();
  }

  /**
   * 关闭服务器
   *
   * ⚠️ 扩展停用时【必须】调用，否则会留下孤儿进程。
   */
  async stop(): Promise<void> {
    this.ready = false;
    this.deadReason = 'MCP 服务器已关闭';
    this.rejectAllPending(new Error(this.deadReason));

    const child = this.child;
    this.child = null;
    if (!child) return;

    try {
      child.stdin.end();
    } catch {
      /* 已经关了 */
    }
    try {
      child.kill();
    } catch {
      /* 已经死了 */
    }
  }
}
