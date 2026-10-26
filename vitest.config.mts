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
    // ⭐ 单测超时从默认 5s 放宽到 60s（2026-10-26 从 30s 提上来）
    //
    //   为什么必须放宽：
    //     evalFramework.test.ts 的两条「baseline 设计铁律」测试要真跑完
    //     30 道题的 check.js（每题都要 copyDir + 逐个执行 case）。
    //     题库从 18 道扩到 23 道再到 30 道，而且新题里还有
    //     沙箱 60-72 个文件的「规模型」题（41-44、46）。
    //
    //   为什么这不是「放宽断言」而是修 bug：
    //     这两条测试守的是整个评测体系最核心的两条约束 ——
    //       · 每题至少 2 个 case 在初始代码上通过（否则 L4 回归检测是摆设）
    //       · 每题至少 1 个 case 在初始代码上失败（否则 agent 什么都不做也满分）
    //     它们因为超时而失败 = 「评测集的基础约束正在失守，但我们不知道」。
    //     这正是本项目 README 里写的「测量工具的 bug 比被测对象更可怕」。
    //
    //   ⭐ 同时做了提速（2026-10-26）：
    //     这两条铁律问的是同一个问题的两面（"baseline 过几个" / "挂几个"），
    //     原来各跑一遍完整流程 = 把最贵的工作做了两遍。
    //     现在合并成一个 beforeAll 跑一次、两条断言共用结果，
    //     并在每题跑完后立刻删沙箱（30 道题几千个文件，别留在磁盘上）。
    //     ⚠️ 没有改成抽样执行 —— 抽样会让"某道题 baseline 设计不合格"被漏掉，
    //     而那正是这两条测试存在的唯一理由。
    //     提速的方式是【别重复算】，不是【少算几个】。
    testTimeout: 60_000,
    hookTimeout: 60_000,
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
      // ⭐ 必须显式排掉 eval/
      //
      //   v8 provider 的行为：include 只控制"哪些文件要补零覆盖条目"，
      //   而【测试期间实际被 require 的文件】无论匹不匹配 include 都会被统计。
      //
      //   eval/tasks/*/check.js 正好在 evalFramework 测试里被 require，
      //   于是 30 道题的 check.js 全被算进了覆盖率 ——
      //   它们是【测试夹具】，不是产品代码，混进来会让数字失真
      //   （实测：混进来之后聚合数是 68.92%，纯产品代码另算）。
      exclude: ['src/__tests__/**', 'eval/**', 'webview-ui/**', 'out/**'],
      reporter: ['text', 'html'],
      // ⭐ 阈值 = 当前实测值 - 3（2026-10-26 实测：60.75 / 55.74 / 59.65 / 61.67）
      //
      //   为什么要设阈值：
      //     覆盖率只跌不涨的话，CI 是察觉不到的 ——
      //     少写一个测试，CI 还是绿的，只是数字悄悄降了。
      //     阈值把"悄悄降"变成"立刻红"。
      //
      //   为什么是"实测值 - 3"而不是整数：
      //     留 3 个点的缓冲 —— 覆盖率会因为改代码自然波动，
      //     差 0.1 个点就红会让人天天去调阈值，最后大家就不看这个数字了。
      //     降 3 个点是真的退步，值得报警。
      //
      //   ⚠️ 改代码后如果覆盖率自然涨了，记得把阈值一起提上去。
      thresholds: {
        statements: 57,
        branches: 52,
        functions: 56,
        lines: 58,
      },
    },
  },
});