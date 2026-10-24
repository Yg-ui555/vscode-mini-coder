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
    // ⭐ 单测超时从默认 5s 放宽到 30s（2026-10-24）
    //
    //   为什么必须放宽：
    //     evalFramework.test.ts 的两条「baseline 设计铁律」测试要真跑完
    //     18 道题的 check.js（每题都要 copyDir + 逐个执行 case）。
    //     实测耗时 6517ms / 10700ms，默认 5000ms 必然超时。
    //
    //   为什么这不是「放宽断言」而是修 bug：
    //     这两条测试守的是整个评测体系最核心的两条约束 ——
    //       · 每题至少 2 个 case 在初始代码上通过（否则 L4 回归检测是摆设）
    //       · 每题至少 1 个 case 在初始代码上失败（否则 agent 什么都不做也满分）
    //     它们因为超时而失败 = 「评测集的基础约束正在失守，但我们不知道」。
    //     这正是本项目 README 里写的「测量工具的 bug 比被测对象更可怕」。
    //
    //   ⚠️ 注意：放宽超时只是止血。真正的提速方案是把这两个测试从
    //     「每次全量执行 18 题」改成「静态结构预筛 + 抽样执行」，
    //     详见 ROADMAP.md Phase 1 任务 1.1 的补充说明。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // ⭐ 全局 setup：设置测试用工作区根 + 跳过写操作确认
    //    （2026-10-20 加路径白名单后必须有，否则临时文件全被判越界）
    setupFiles: ['./src/__tests__/setup.ts'],
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