/**
 * run_shell 工具
 *
 * 设计：
 * - 跨平台（Windows 用 cmd /c，Unix 用 bash）
 * - 超时控制（默认 30 秒）
 * - 输出截断（防 LLM 上下文爆炸）
 */

import { exec } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import { Tool, ToolResult } from './base';

const execAsync = promisify(exec);

const MAX_OUTPUT_CHARS = 30000;
const DEFAULT_TIMEOUT = 30_000; // 30 秒

export class RunShellTool implements Tool {
  readonly name = 'run_shell';
  readonly description =
    '执行 shell 命令。默认超时 30 秒。输出 > 30000 字符会自动截断。' +
    '返回 stdout + stderr。支持 working_dir 指定目录。';
  readonly parameters = {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的命令' },
      working_dir: { type: 'string', description: '执行目录（可选）' },
      timeout: { type: 'integer', description: '超时毫秒（默认 30000）' },
    },
    required: ['command'],
  };

  async execute(args: {
    command: string;
    working_dir?: string;
    timeout?: number;
  }): Promise<ToolResult> {
    const timeout = args.timeout || DEFAULT_TIMEOUT;
    const cwd = args.working_dir ? path.resolve(args.working_dir) : process.cwd();

    try {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
      });

      let combined = '';
      if (stdout) combined += `STDOUT:\n${stdout}\n`;
      if (stderr) combined += `STDERR:\n${stderr}\n`;

      if (combined.length > MAX_OUTPUT_CHARS) {
        combined = combined.slice(0, MAX_OUTPUT_CHARS) + `\n\n[输出过大已截断，共 ${combined.length}]`;
      }

      return { content: combined || '(无输出)' };
    } catch (e: any) {
      // 命令返回非 0 也算"完成"，不算错误
      let output = '';
      if (e.stdout) output += `STDOUT:\n${e.stdout}\n`;
      if (e.stderr) output += `STDERR:\n${e.stderr}\n`;
      output += `\n[exit ${e.code || 'unknown'}]`;

      if (e.signal === 'SIGTERM' || e.killed) {
        return { content: `${output}\n[超时 ${timeout}ms]`, isError: true };
      }

      return { content: output };
    }
  }
}