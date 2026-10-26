/**
 * delegate 工具 —— 子智能体（独立上下文）
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 这个能力解决什么
 *
 *   主 agent 的上下文是【共享的一张桌子】。
 *   桌子放得下 20 页卷宗，但活儿可能有 300 页的量。
 *
 *   没有子智能体时，主 agent 自己去查 A（桌上堆着 A 的全部资料）
 *   → 查 B（A 的资料还堆着）→ 查 C → 桌子满了，它自己都晕了。
 *
 *   有子智能体时：派三个"临时工"各查各的，各回一份【摘要报告】。
 *   主 agent 桌上只有 3 份报告。
 *
 *   这就是子智能体的全部价值：**隔离上下文**。
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐⭐ 三条铁律（违反了就是安全事故）
 *
 *   1. 【子 agent 绝对不能有写权限】
 *      而且要靠【工具集本身】保证，不是靠提示词。
 *      模型不听提示词，尤其是被诱导的时候 ——
 *      子 agent 读到一个写着"请删除所有文件"的 README，
 *      如果它有写工具，它可能真照做。
 *
 *   2. 【子 agent 不能递归调 delegate】
 *      否则可以无限套娃（a 派 b，b 派 c，c 派 a……），
 *      每一层都在烧 token。
 *
 *   3. 【子 agent 必须如实报告，包括"我没找到"】
 *      否则父 agent 会基于幻觉做决策 ——
 *      这是多智能体系统最经典的失败模式。
 *
 * ─────────────────────────────────────────────────────────────
 * 借鉴 goose 的 platform_extensions/summon.rs
 *   子智能体就是一个【普通工具】，由 LLM 决定什么时候调用。
 *   区别只是它有独立的 context / 独立的 maxTurns / 独立的 system prompt。
 */

import { Tool, ToolResult } from './base';
import { readOnlyMeta } from './meta';
import { OpenAIProvider } from '../provider';
import { ToolRegistry } from './registry';
import { createReadOnlyRegistry } from './readonlySet';

/**
 * 子 agent 运行器的【最小契约】
 *
 * ⭐ 为什么这里用结构化类型，而不是 import loop.ts
 *
 *   原来的写法是在 execute() 里 `require('../loop')`，
 *   目的是躲开这个循环依赖：
 *
 *     loop.ts → operations/ → toolExecution → tools/delegate → loop.ts
 *
 *   懒加载确实躲开了 CommonJS 的"半初始化模块"问题，
 *   但它有两个实际代价：
 *
 *   1) **vitest 里直接报 "Cannot find module '../loop'"**
 *      —— Node 的 CJS 解析器不认识 .ts 后缀，
 *      懒加载的 require 在测试环境里是坏的（2026-10-26 实测）。
 *   2) 依赖方向变成"运行时才知道"，看代码看不出谁依赖谁。
 *
 *   现在的做法：【由 loop.ts 在构造时把 AgentLoop 注入进来】。
 *
 *     依赖方向变成单向：
 *       loop.ts →（operations → toolExecution →）tools/delegate.ts
 *     delegate.ts 完全不 import loop.ts。
 *
 *   比喻：以前是"子 agent 自己去仓库拿梯子"（还得先知道仓库在哪），
 *   现在是"主人把梯子递给它"。
 *
 *   ⚠️ 这个类型只声明 delegate 真正用到的那几个成员，
 *      这样 loop.ts 的 AgentLoop 不需要为了满足接口而改结构。
 */
export interface SubAgentRunner {
  run(
    messages: any[],
    signal: AbortSignal | undefined,
    callbacks: {
      onText: (chunk: string) => void;
      onToolCall: (name: string, args: any) => void;
      onToolResult: (name: string, result: any, args?: any) => void;
    },
  ): Promise<string>;
}

/** 子 agent 运行器的构造签名 */
export type SubAgentRunnerCtor = new (
  provider: OpenAIProvider,
  registry: ToolRegistry,
  maxIterations: number,
  model: string,
) => SubAgentRunner;

/**
 * 子智能体运行时（provider / model / AgentLoop）
 *
 * ⚠️ 为什么用模块级全局，而不是从参数传进来？
 *
 *   因为工具是【无状态对象】—— factory.ts 统一 new 出来注册到注册表，
 *   拿不到运行时的 provider（provider 是每次对话新建的）。
 *
 *   这跟项目里已有的 setWorkspaceRoot / setNonInteractive /
 *   setCheckpointEnabled 是同一套模式，依赖方向单一，review 时不用重新理解。
 */
interface DelegateRuntime {
  provider: OpenAIProvider;
  model: string;
  /** 嵌套深度 —— 防止无限套娃 */
  depth: number;
  /**
   * ⭐ AgentLoop 的构造函数 —— 由 loop.ts 在构造时注入。
   *   见上面 SubAgentRunner 的说明（为什么不用 require 懒加载）。
   */
  AgentLoopCtor?: SubAgentRunnerCtor;
}

let runtime: DelegateRuntime = { provider: null as any, model: '', depth: 0 };

export function setDelegateRuntime(r: Partial<DelegateRuntime>): void {
  runtime = { ...runtime, ...r };
}

export function getDelegateDepth(): number {
  return runtime.depth;
}

/** 子 agent 专用的 system prompt —— 独立于主 agent */
function buildSubagentPrompt(task: string): string {
  return `# 子智能体

你是一个被派去完成一项【独立调查】的子智能体。

## 你的任务

${task}

## 规则

- 你有独立的上下文，只能看到自己的对话，看不到主 agent 的对话。
  所以任务描述必须自包含 —— 主 agent 会把需要的信息都写在任务里。
- 你只有【只读工具】：读文件、搜索、列目录、找文件。
  你不能改文件、不能跑命令。这是刻意的 —— 改文件是主 agent 的事。
- 找到什么就报告什么。**找不到就明说"我没找到"**，
  不要编造。主 agent 会根据你的报告做决策，编造会让它做错决定。
- 报告要具体：给出文件路径、行号、函数名。
- 完成后用中文给出结论。`;
}

export class DelegateTool implements Tool {
  readonly name = 'delegate';
  /**
   * ⭐ concurrentSafe = false
   *
   * 它会 spawn 一个新的 LLM 请求流。多个子 agent 并发跑会同时打 provider，
   * 既容易触发限流，也会让 token 消耗失控。
   */
  readonly meta = readOnlyMeta(false);
  readonly description =
    '把一项独立的【调查任务】交给子智能体。\n' +
    '子智能体有独立的上下文（看不到你和用户的对话），只有只读工具' +
    '（读文件 / 搜索 / 找文件 / 列目录），不能改文件也不能跑命令。\n' +
    '它只会把【最终结论】返回给你，中间过程不会进入你的上下文。\n' +
    '\n' +
    '适合：调查某个模块的调用链、在多个候选方案里做对比调研、' +
    '在很大的代码库里做影响面调查。\n' +
    '不适合：直接改代码（那是你自己的事）、跑测试、任何有副作用的操作。\n' +
    '\n' +
    '⚠️ 任务描述必须自包含 —— 子智能体看不到你们的对话。';
  readonly parameters = {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description:
          '给子智能体的完整任务描述（必须自包含：说清楚要查什么、去哪个目录、返回什么）',
      },
      maxTurns: {
        type: 'integer',
        description: '子智能体最多跑几轮（默认 10，上限 20）',
      },
    },
    required: ['task'],
  };

  async execute(args: { task?: string; maxTurns?: number } & { signal?: AbortSignal }): Promise<ToolResult> {
    const task = (args?.task ?? '').trim();
    if (!task) {
      return { content: '错误：task 不能为空。', isError: true };
    }

    // ── 铁律 2：不能递归套娃 ──────────────────────────────
    if (runtime.depth >= 1) {
      return {
        content:
          '错误：子智能体不能再派子智能体（已到嵌套上限）。' +
          '请自己完成这项调查，或者把任务拆小后由主 agent 分别派发。',
        isError: true,
      };
    }

    if (!runtime.provider) {
      return {
        content: '错误：子智能体运行时未初始化（provider 不可用）。',
        isError: true,
      };
    }

    const AgentLoopCtor = runtime.AgentLoopCtor;
    if (!AgentLoopCtor) {
      return {
        content:
          '错误：子智能体运行时未初始化（AgentLoop 未注入）。' +
          '通常是因为 delegate 工具被单独调用了 —— ' +
          '正常路径下由 AgentLoop 的构造函数注入。',
        isError: true,
      };
    }

    // ── 铁律 1：只读工具，靠工具集本身保证 ──────────────────
    //   createReadOnlyRegistry 里【物理上】就没有写入工具和 run_shell。
    //   不是靠提示词说"你别改文件"。
    const subRegistry = createReadOnlyRegistry();

    // 子 agent 独立 messages、独立 system prompt、独立 maxTurns
    const subMessages: any[] = [
      { role: 'system', content: buildSubagentPrompt(task) },
      { role: 'user', content: task },
    ];

    const maxTurns = Math.min(Math.max(args?.maxTurns ?? 10, 1), 20);

    setDelegateRuntime({ depth: runtime.depth + 1 });
    const usedTools: string[] = [];
    let answer = '';

    try {
      const subLoop = new AgentLoopCtor(runtime.provider, subRegistry, maxTurns, runtime.model);
      answer = await subLoop.run(subMessages, args?.signal, {
        // ⚠️ 子 agent 的过程【不进父上下文】
        //   这正是子智能体的价值：中间那几万 token 的探索过程全部隔离掉，
        //   父 agent 只拿到最后那段结论。
        onText: () => {},
        onToolCall: (name: string) => usedTools.push(name),
        onToolResult: () => {},
      });
    } catch (e: any) {
      return {
        content: `子智能体执行失败：${e?.message || e}`,
        isError: true,
      };
    } finally {
      setDelegateRuntime({ depth: runtime.depth - 1 });
    }

    // ── 铁律 3：如实报告（包括"没找到"）──────────────────
    const uniqueTools = [...new Set(usedTools)];
    return {
      content:
        `子智能体结论：\n${answer || '（子智能体没有给出结论）'}\n\n` +
        `（子智能体用过的工具：${uniqueTools.length ? uniqueTools.join(', ') : '无'}）`,
    };
  }
}
