/**
 * Vitest 配置
 *
 * 为什么是 .mts：避免 "ESM syntax in a file loaded as CommonJS" warning
 * 因为 src/package.json 没设 "type": "module"
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    // 测试时 worker 进程强制 UTF-8（避免中文 Windows GBK mojibake）
    env: {
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
    },
    // 把 vscode 模块 alias 到 stub（slashCommands 等链式依赖 vscode）
    alias: {
      vscode: new URL('./src/__tests__/stubs/vscode-stub.ts', import.meta.url).pathname,
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', '!src/**/*.d.ts', '!src/__tests__/**'],
      reporter: ['text', 'html'],
    },
  },
});