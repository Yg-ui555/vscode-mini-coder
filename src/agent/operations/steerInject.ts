/**
 * steerInject —— 用户中途插话
 *
 * ─────────────────────────────────────────────────────────────
 * 这个能力解决什么
 *
 *   agent 正在改 5 个文件，用户突然说"等等，第 3 个文件先别动"。
 *
 *   改造前只能点"停止"重来 —— 前面做的活全白费。
 *   有 steering 的话，用户消息会【排队】，在当前工具批次完成后注入。
 *
 *   比喻：秘书正在写稿，老板说"这句改一下"——
 *   秘书不会推倒重写，而是记下来，在下一个自然停顿的地方改。
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 为什么不打断正在执行的工具
 *
 *   打断会留下半执行状态：文件改了一半、命令跑了一半。
 *   而 steerInject 排在管线的【工具执行之前】，
 *   所以它注入的时机天然就是"上一批工具已经跑完、下一批还没开始"。
 *
 * ─────────────────────────────────────────────────────────────
 * 借鉴 goose 的 ops_steer.rs:60-97
 *   它也只在"两轮之间"且"没有待答工具请求"时生效。
 */

import { Operation, OperationResult, notApplicable, applied } from './types';

export const steerInjectOperation: Operation = {
  name: 'steer_inject',

  async run(ctx): Promise<OperationResult> {
    const queue = ctx.state.steeringQueue;
    if (!queue || queue.length === 0) return notApplicable();

    // ⭐ 取走并清空 —— 插话只生效一次。
    //   留在队列里的话，下一轮会被重复注入，模型会收到同一条消息好几次。
    const queued = queue.splice(0, queue.length);
    if (queued.length === 0) return notApplicable();

    for (const msg of queued) {
      ctx.messages.push({
        role: 'user',
        content: `[用户插话] ${msg}`,
        // ⭐ pinned —— 用户的最新指令不能被压缩掉。
        //   插话是"用户刚说的话"，属于当前指令，不是历史记录。
        pinned: true,
      });
    }

    return applied();
  },
};
