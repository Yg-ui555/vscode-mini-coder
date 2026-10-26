/**
 * 工具调用分批 —— 按副作用安全性把 tool_calls 分组
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么要分批，不能无脑全并行
 *
 *   比喻：
 *     你让助理去复印三份文件、并把三份分别装订。
 *     改造前：复印 1 → 等 → 复印 2 → 等 → 复印 3 → 等
 *     改造后：复印 1/2/3 同时开始 → 等 → 三份一起装订
 *
 *     前提是这三件事互不干扰 —— 你不能一边复印一边把原件撕了。
 *
 * ─────────────────────────────────────────────────────────────
 * 分批规则（从安全到危险）
 *
 *   1. 只读工具（read / grep / glob / list_dir）→ 一批，可并行
 *      它们没有任何副作用，互不干扰。
 *   2. 写工具（apply_patch / write_file / restore_file）→ 各自单独一批，串行
 *      两个 patch 同时改同一个文件会互相覆盖；
 *      而且它们要弹审批窗，两个弹窗同时弹会让用户懵。
 *   3. 执行工具（run_shell）→ 单独一批，串行
 *      命令的副作用在 agent 控制之外，必须一个个来。
 *
 * ⚠️ 关键：批次的【顺序】必须跟原始 tool_calls 顺序一致。
 *   因为回填结果时 messages.push 的顺序决定协议合法性
 *   （tool_call_id 与 tool 消息必须一一对应且紧邻）。
 *
 * ─────────────────────────────────────────────────────────────
 * 借鉴来源
 *
 *   · nanobot/agent/tools/execution.py:294-318 _partition_tool_batches
 *   · nanobot/agent/tools/base.py:216-229（read_only / concurrency_safe 语义）
 *   · goose/agents/state_machine/ops_toolcalling.rs:1010-1044（并发轮询）
 */

import { ToolRegistry } from './registry';

/**
 * ⭐ 工具调用批次：一批内的工具可以并行执行
 */
export interface ToolCallBatch {
  calls: Array<{ id: string; name: string; arguments: string }>;
  /** 这一批能否并行 */
  parallel: boolean;
}

/**
 * 按安全性把 tool_calls 分批
 *
 * @param toolCalls LLM 返回的原始 tool_calls 数组
 * @param registry  工具注册表（用来查每个工具的 meta）
 */
export function partitionToolCalls(
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
  registry: ToolRegistry,
): ToolCallBatch[] {
  const batches: ToolCallBatch[] = [];
  let readBatch: ToolCallBatch | null = null;

  for (const tc of toolCalls) {
    const tool = registry.get(tc.name);
    const meta = tool?.meta;

    // ⭐ 判定依据：既看「只读」，也看「可并发」
    //
    //   concurrentSafe 这个字段在本项目定义了却从没被用过
    //   （tools/meta.ts:48-52）。2026-10-24 改造时把它接上了。
    //
    //   为什么要两个字段？
    //     readOnly      = 有没有副作用（决定要不要审批、要不要 checkpoint）
    //     concurrentSafe = 能不能和别的工具同时跑（决定要不要并行）
    //
    //   理论上"只读"必然"可并发"，但反过来不成立：
    //     未来的某个工具可能「有副作用但可并发」
    //     （比如往两个不同文件写 —— 各自独立，不会互相覆盖）。
    //     现在的实现里两者等价，是刻意的保守选择：
    //     宁可少并行，也不要引入一类"看起来能并行其实会打架"的 bug。
    //
    // ⚠️ 拿不到 meta 的工具（未注册）→ 按【不可并行】处理。
    //   未知工具的副作用范围是未知的，保守是对的。
    const isReadOnly = meta?.readOnly === true || meta?.kind === 'read';
    const canRunConcurrently = meta?.concurrentSafe === true;

    if (isReadOnly && canRunConcurrently) {
      // 只读且可并发 → 都进同一个并行批次
      if (!readBatch) {
        readBatch = { calls: [], parallel: true };
        batches.push(readBatch);
      }
      readBatch.calls.push(tc);
      continue;
    }

    // 其余（写 / 执行 / 元数据缺失）→ 各自单独一批，串行
    // 为什么要单独一批而不是把所有写工具放一起：
    //   · 两个 apply_patch 改同一个文件 → 互相覆盖
    //   · checkpoint 快照会乱（一次调用一个快照的语义被破坏）
    //   · 审批弹窗同时弹，用户懵
    batches.push({ calls: [tc], parallel: false });
    readBatch = null;
  }

  return batches;
}
