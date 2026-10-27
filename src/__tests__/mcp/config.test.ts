/**
 * MCP 配置读取测试
 *
 * 重点测三件容易出事的事：
 *   1. 配置写错了不能崩（一个坏条目不该让整个功能不可用）
 *   2. ${workspaceFolder} 替换要正确
 *   3. 变量替换【只支持这一个】—— 不能变成任意表达式执行
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readMcpConfigFile,
  parseServers,
  substituteVars,
  collectMcpConfigs,
  WORKSPACE_MCP_CONFIG,
} from '../../agent/mcp/config';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-coder-mcfg-'));
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* Windows 上偶尔残留 */
  }
});

function writeConfig(obj: unknown): string {
  const p = path.join(tmpDir, 'mcp.json');
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf-8');
  return p;
}

describe('变量替换', () => {
  it('${workspaceFolder} 要换成真实路径', () => {
    expect(substituteVars('${workspaceFolder}/src', 'D:\\proj')).toBe('D:\\proj/src');
  });

  it('没有变量时原样返回', () => {
    expect(substituteVars('npx', 'D:\\proj')).toBe('npx');
  });

  it('⚠️ 只支持 ${workspaceFolder}，其它表达式不当成变量', () => {
    // 绝不能把 ${...} 里的内容当 shell 表达式执行
    expect(substituteVars('$(whoami)', 'D:\\proj')).toBe('$(whoami)');
    expect(substituteVars('${env:SECRET}', 'D:\\proj')).toBe('${env:SECRET}');
    expect(substituteVars('`id`', 'D:\\proj')).toBe('`id`');
  });
});

describe('配置解析', () => {
  it('正常配置要解析出服务器列表', () => {
    const list = parseServers(
      {
        servers: [
          {
            name: 'filesystem',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '${workspaceFolder}'],
          },
        ],
      },
      'D:\\proj',
    );

    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('filesystem');
    expect(list[0].command).toBe('npx');
    expect(list[0].args[2]).toBe('D:\\proj');
    expect(list[0].cwd).toBe('D:\\proj');
  });

  it('⭐ 坏条目要跳过，不能让整个配置报废', () => {
    const list = parseServers(
      {
        servers: [
          { name: '', command: 'npx' },        // 没名字
          { name: 'x' },                        // 没命令
          { command: 'npx' },                   // 没名字
          null as any,                          // 不是对象
          { name: 'ok', command: 'npx' },       // 好的
        ],
      },
      null,
    );

    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('ok');
  });

  it('enabled: false 要被跳过', () => {
    const list = parseServers(
      {
        servers: [
          { name: 'off', command: 'npx', enabled: false },
          { name: 'on', command: 'npx' },
        ],
      },
      null,
    );
    expect(list.map((s) => s.name)).toEqual(['on']);
  });

  it('⭐ 重名时保留第一个', () => {
    const list = parseServers(
      {
        servers: [
          { name: 'dup', command: 'first' },
          { name: 'dup', command: 'second' },
        ],
      },
      null,
    );
    expect(list).toHaveLength(1);
    expect(list[0].command).toBe('first');
  });

  it('env 里的变量也要替换', () => {
    const list = parseServers(
      {
        servers: [
          {
            name: 'x',
            command: 'npx',
            env: { ROOT: '${workspaceFolder}/data', PLAIN: 'v' },
          },
        ],
      },
      'D:\\proj',
    );
    expect(list[0].env?.ROOT).toBe('D:\\proj/data');
    expect(list[0].env?.PLAIN).toBe('v');
  });
});

describe('配置文件读取', () => {
  it('文件不存在时返回空数组（不抛错）', () => {
    expect(readMcpConfigFile(path.join(tmpDir, 'nope.json'), null)).toEqual([]);
  });

  it('⭐ 文件坏了要跳过并提示，不能抛错', () => {
    const p = path.join(tmpDir, 'broken.json');
    fs.writeFileSync(p, '{ this is not json', 'utf-8');
    expect(readMcpConfigFile(p, null)).toEqual([]);
  });

  it('正常文件能读出来', () => {
    const p = writeConfig({
      servers: [{ name: 'a', command: 'npx', args: [] }],
    });
    const list = readMcpConfigFile(p, null);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('a');
  });
});

describe('多来源汇总', () => {
  it('⭐ 工作区级要覆盖全局级（同名）', () => {
    const globalPath = writeConfig({
      servers: [{ name: 'shared', command: 'global-cmd', args: [] }],
    });

    // 工作区级
    const vscodeDir = path.join(tmpDir, '.vscode');
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, WORKSPACE_MCP_CONFIG),
      JSON.stringify({
        servers: [
          { name: 'shared', command: 'workspace-cmd', args: [] },
          { name: 'only-ws', command: 'ws', args: [] },
        ],
      }),
      'utf-8',
    );

    const all = collectMcpConfigs(tmpDir, globalPath);
    const shared = all.find((s) => s.name === 'shared');
    expect(shared?.command).toBe('workspace-cmd');
    expect(all.find((s) => s.name === 'only-ws')).toBeTruthy();
  });

  it('没有工作区时只有全局配置', () => {
    const globalPath = writeConfig({
      servers: [{ name: 'a', command: 'npx', args: [] }],
    });
    const all = collectMcpConfigs(null, globalPath);
    expect(all).toHaveLength(1);
  });
});
