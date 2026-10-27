/**
 * MCP 客户端测试
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 为什么用"假服务器"而不是连真的 MCP server
 *
 *   连真的（比如 npx @modelcontextprotocol/server-filesystem）有三个问题：
 *     1. 要联网下载 —— CI 里不稳定
 *     2. 行为受第三方版本影响 —— 测着测着就红了
 *     3. 测不了"服务器起不来""超时""返回奇怪格式"这些异常分支
 *
 *   所以这里在【运行时生成】一个最小的 MCP 服务器脚本，
 *   写到临时目录，用 node 跑起来 —— 行为完全可控。
 *
 *   比喻：测消防系统不用真的放火，用一个能模拟各种情况的假火源。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpStdioClient, McpServerConfig } from '../../agent/mcp/stdioClient';
import { McpTool } from '../../agent/mcp/mcpTool';
import { ToolRegistry } from '../../agent/tools/registry';

/**
 * 假 MCP 服务器的源码
 *
 * 它实现了协议里我们用到的三个方法，外加几个"故障开关"，
 * 用来测异常分支。
 */
const FAKE_SERVER_SRC = `
const readline = require('readline');
const opts = JSON.parse(process.env.MC_FAKE_OPTS || '{}');

// ⚠️ 故障开关：模拟"服务器根本起不来"
if (opts.exitEarly) {
  process.exit(1);
}

// ⚠️ 故障开关：往 stdout 打一行非 JSON 的日志
//    （真实的 MCP server 经常这么干 —— 客户端必须能容错）
if (opts.noisy) {
  process.stdout.write('[fake-mcp] booting...\\n');
}

const rl = readline.createInterface({ input: process.stdin });

// ⚠️ 故障开关：永不响应，测客户端超时
if (!opts.hang) {
  rl.on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!msg || msg.method === undefined) return;

    const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');

    if (msg.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'fake-mcp', version: '1.0.0' },
        },
      });
    } else if (msg.method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: opts.tools || [
            {
              name: 'echo',
              description: '回显传入的文本',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
              annotations: { readOnlyHint: true },
            },
          ],
        },
      });
    } else if (msg.method === 'tools/call') {
      if (opts.failCall) {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: 'fake failure on purpose' },
        });
      } else {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: 'echo:' + (msg.params.arguments || {}).text }],
          },
        });
      }
    }
    // notifications/initialized 是通知（没有 id）—— 不回，这是对的
  });
}

// ⚠️ 故障开关：进程活着但永不回答
if (opts.hang) {
  setInterval(() => {}, 1000);
}
`;

let tmpDir: string;
let serverScript: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-coder-mcp-'));
  serverScript = path.join(tmpDir, 'fake-mcp-server.js');
  fs.writeFileSync(serverScript, FAKE_SERVER_SRC, 'utf-8');
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* Windows 上偶尔会残留，忽略 */
  }
});

/**
 * 造一个指向假服务器的配置
 */
function makeConfig(
  opts: Record<string, unknown> = {},
  extra: Partial<McpServerConfig> = {},
): McpServerConfig {
  return {
    name: 'fake',
    command: process.execPath, // 用当前 node 的绝对路径，避免 PATH 问题
    args: [serverScript],
    env: { MC_FAKE_OPTS: JSON.stringify(opts) },
    timeoutMs: 5000,
    ...extra,
  };
}

describe('MCP stdio 客户端', () => {
  it('握手 + 拉到工具清单', async () => {
    const client = new McpStdioClient(makeConfig());
    await client.start();

    expect(client.isReady).toBe(true);
    const tools = client.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('echo');

    await client.stop();
  });

  it('能调用工具并拿到结果', async () => {
    const client = new McpStdioClient(makeConfig());
    await client.start();

    const text = await client.callTool('echo', { text: 'hi' });
    expect(text).toBe('echo:hi');

    await client.stop();
  });

  it('⭐ stdout 里有非 JSON 的日志也不能崩', async () => {
    // 这是真实场景：很多 MCP server 启动时会打自己的日志
    const client = new McpStdioClient(makeConfig({ noisy: true }));
    await client.start();

    expect(client.isReady).toBe(true);
    const text = await client.callTool('echo', { text: 'ok' });
    expect(text).toBe('echo:ok');

    await client.stop();
  });

  it('服务器起不来时 start() 要抛错（而不是永远挂着）', async () => {
    const client = new McpStdioClient(
      makeConfig({ exitEarly: true }, { timeoutMs: 2000 }),
    );

    await expect(client.start()).rejects.toThrow();
    await client.stop();
  });

  it('命令不存在时 start() 要抛错', async () => {
    const client = new McpStdioClient({
      name: 'nope',
      command: 'this-command-definitely-does-not-exist-xyz',
      args: [],
      timeoutMs: 2000,
    });

    await expect(client.start()).rejects.toThrow();
    await client.stop();
  });

  it('服务器挂起时要超时，而不是永远等', async () => {
    const client = new McpStdioClient(
      makeConfig({ hang: true }, { timeoutMs: 800 }),
    );

    await expect(client.start()).rejects.toThrow(/超时|timeout/i);
    await client.stop();
  });

  it('工具调用失败时要返回错误而不是崩掉', async () => {
    const client = new McpStdioClient(makeConfig({ failCall: true }));
    await client.start();

    await expect(client.callTool('echo', { text: 'x' })).rejects.toThrow(
      /fake failure/i,
    );

    await client.stop();
  });
});

describe('MCP 工具包装', () => {
  it('工具名要带命名空间前缀', async () => {
    const client = new McpStdioClient(makeConfig());
    await client.start();

    const tool = new McpTool(client, 'fake', client.getTools()[0]);
    expect(tool.name).toBe('mcp__fake__echo');
    expect(tool.description).toContain('fake');

    await client.stop();
  });

  it('⭐ readOnlyHint: true 的工具按只读处理（自动放行）', async () => {
    const client = new McpStdioClient(makeConfig());
    await client.start();

    const tool = new McpTool(client, 'fake', client.getTools()[0]);
    expect(tool.meta.readOnly).toBe(true);
    expect(tool.meta.kind).toBe('read');
    expect(tool.meta.concurrentSafe).toBe(true);

    await client.stop();
  });

  it('⭐ 没声明只读的工具按"写"处理（每次要确认）', async () => {
    const client = new McpStdioClient(
      makeConfig({
        tools: [
          {
            name: 'danger',
            description: '会改东西的工具',
            inputSchema: { type: 'object', properties: {} },
            // 没有 annotations
          },
        ],
      }),
    );
    await client.start();

    const tool = new McpTool(client, 'fake', client.getTools()[0]);
    expect(tool.meta.readOnly).toBe(false);
    expect(tool.meta.kind).toBe('write');
    // checkpoint 对 MCP 没有意义（它改的文件我们不知道是哪个）
    expect(tool.meta.needsCheckpoint).toBe(false);

    await client.stop();
  });

  it('执行失败时返回 isError（不抛异常），让 LLM 能自我纠错', async () => {
    const client = new McpStdioClient(makeConfig({ failCall: true }));
    await client.start();

    const tool = new McpTool(client, 'fake', client.getTools()[0]);
    const result = await tool.execute({ text: 'x' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('mcp__fake__echo');
    // ⭐ 措辞要和 registry.ts 的统一提示保持一致（模型见多了这个句式更好认）
    expect(result.content).toContain('换一个不同的做法');

    await client.stop();
  });

  it('MCP 工具能注册进注册表，并出现在给 LLM 的 schema 里', async () => {
    const client = new McpStdioClient(makeConfig());
    await client.start();

    const registry = new ToolRegistry();
    registry.register(new McpTool(client, 'fake', client.getTools()[0]));

    const names = registry.names;
    expect(names).toContain('mcp__fake__echo');

    // schema 是实时算的 —— 所以 MCP 工具注册后立刻就进 LLM 视野
    const schemaNames = registry.schemas.map((s: any) => s.function.name);
    expect(schemaNames).toContain('mcp__fake__echo');

    await client.stop();
  });

  it('⭐ 现有 resolveAlias 能认出带命名空间的名字（兼容性）', async () => {
    const client = new McpStdioClient(makeConfig());
    await client.start();

    const registry = new ToolRegistry();
    registry.register(new McpTool(client, 'fake', client.getTools()[0]));

    // 模型把名字写错（少了命名空间）—— 应该能纠正回来
    expect(registry.resolveAlias('echo')).toBe('mcp__fake__echo');
    expect(registry.resolveAlias('mcp__fake__echo')).toBe('mcp__fake__echo');

    await client.stop();
  });
});
