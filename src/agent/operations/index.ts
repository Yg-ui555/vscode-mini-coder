/**
 * Operation 管线组装
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 这个数组的顺序【就是】执行顺序
 *
 *   改造前这个顺序藏在一个 1000 行的 while 循环里，
 *   要确认"压缩到底在调 LLM 之前还是之后"得把整个方法读完。
 *   现在一眼可见，而且顺序有讲究，注释写清楚了原因。
 *
 * ─────────────────────────────────────────────────────────────
 * 顺序的依据
 *
 *   1. abort            —— 中断优先级最高。用户说了停就别再发请求（那是在烧钱）
 *   2. maxIterations    —— 触顶检查放这里，语义是"这一轮开始前就超了"
 *   3. userPromptSubmit —— 只在第 0 轮跑（"用户刚提交了一条 prompt"的语义）
 *   4. contextGuard     —— 压缩必须在调 LLM 【之前】，否则这一轮就白发了
 *   5. inference        —— 核心：调一次 LLM，把响应记进 ctx.state.lastResponse
 *   6. toolExecution    —— 只在 lastResponse 里有 tool_calls 时才执行
 *   7. stopHook         —— 只在 lastResponse 里【没有】tool_calls 时才说话
 *
 *   ⚠️ 6 和 7 是互斥的，靠 lastResponse.toolCalls.length 区分。
 *      这就是原来那个 if/else 分支 —— 它没有消失，
 *      只是从"主循环里的分支"变成了"两个 Operation 各自判断适不适用"。
 *      好处是：两个 Operation 都能单独测，而且谁先谁后一目了然。
 *
 * ─────────────────────────────────────────────────────────────
 * 以后要加新能力，往这个数组里加一项就行
 *
 *   例如 Phase 5 加的 steerInject（用户插话）和 todoInject（待办清单），
 *   就是分别加在这两个位置：
 *     · steerInject  → 在 contextGuard 之前（插话要在压缩前生效，
 *                       否则可能被压掉）
 *     · todoInject   → 在 contextGuard 之前（同上）
 */

import { Operation } from './types';
import { abortOperation } from './abort';
import { maxIterationsOperation } from './maxIterations';
import { userPromptSubmitOperation } from './userPromptSubmit';
import { contextGuardOperation } from './contextGuard';
import { inferenceOperation } from './inference';
import { toolExecutionOperation } from './toolExecution';
import { stopHookOperation } from './stopHook';
import { steerInjectOperation } from './steerInject';
import { todoInjectOperation } from './todoInject';

export function buildPipeline(): Operation[] {
  return [
    abortOperation,
    maxIterationsOperation,
    userPromptSubmitOperation,
    steerInjectOperation,
    todoInjectOperation,
    contextGuardOperation,
    inferenceOperation,
    toolExecutionOperation,
    stopHookOperation,
  ];
}

/** 全部 Operation（自检脚本用它检查有没有漏注册） */
export const ALL_OPERATION_NAMES = [
  'abort',
  'max_iterations',
  'user_prompt_submit',
  'steer_inject',
  'todo_inject',
  'context_guard',
  'inference',
  'tool_execution',
  'stop_hook',
];

export {
  abortOperation,
  maxIterationsOperation,
  userPromptSubmitOperation,
  steerInjectOperation,
  todoInjectOperation,
  contextGuardOperation,
  inferenceOperation,
  toolExecutionOperation,
  stopHookOperation,
};
