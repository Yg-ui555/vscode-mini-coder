/**
 * todoInject —— 每轮重建待办状态并注入上下文
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 这一步是"待办清单不丢"的全部秘密
 *
 *   上下文压缩会压掉对话历史。如果待办状态只存在于某条历史消息里，
 *   压缩之后就跟着没了 —— 模型会"忘了"自己走到第几步。
 *
 *   所以这里的做法是：
 *     每轮请求前，把【当前】待办状态重新渲染成一条 system 消息，
 *     并【替换】掉上一轮的那条。
 *
 *   比喻：不是把待办清单贴在墙上（墙会被擦掉），
 *   而是每次开工前【重新抄一份】给模型看。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么用 replace 而不是 push
 *
 *   ReAct 循环每一步都要重发全部上下文。
 *   追加的话，上下文里会堆 N 条历史待办快照 ——
 *   纯烧钱，而且模型会看到互相矛盾的历史状态。
 *
 * ─────────────────────────────────────────────────────────────
 * 借用了 loop.ts 的双可见性机制
 *
 *   这条 system 消息标 userVisible=false ——
 *   用户在面板里不需要看到"当前进度"这种技术性内容，
 *   但模型必须看到。
 */

import { getTodoStore } from '../todo/store';
import { Operation, OperationResult, notApplicable, applied } from './types';

/** 用来定位"这条消息是待办状态"的标记 */
const TODO_MESSAGE_KEY = '__todo_state';

export const todoInjectOperation: Operation = {
  name: 'todo_inject',

  async run(ctx): Promise<OperationResult> {
    const store = getTodoStore();
    if (store.isEmpty) {
      // 没有待办 → 如果之前注入过，把那条清掉（避免留下过期状态）
      removeTodoMessage(ctx.messages);
      return notApplicable();
    }

    const block = store.render();

    // ⭐ 替换而不是追加
    const existing = ctx.messages.find((m: any) => m?.[TODO_MESSAGE_KEY] === true);
    if (existing) {
      existing.content = block;
      // ⭐ 双保险：万一这条消息被压缩标成了 agentVisible=false，
      //   这里把它救回来。
      //   （正常情况下 contextGuard 的 pinned 机制会挡住，
      //     但"状态消息必须对模型可见"这件事值得多一道保险 ——
      //     这条消息一旦丢了，多步任务就会从头再来）
      existing.agentVisible = true;
      return applied();
    }

    ctx.messages.push({
      role: 'system',
      content: block,
      agentVisible: true,
      // 用户不用看"当前进度"这种内部状态
      userVisible: false,
      // ⭐ pinned —— 永不参与上下文压缩
      //   待办清单是"当前状态"，不是"历史记录"。
      //   比喻：白板上的"本季度目标"不会被保洁擦掉。
      pinned: true,
      [TODO_MESSAGE_KEY]: true,
    });

    return applied();
  },
};

/** 移除之前注入的待办消息（清单清空时用） */
function removeTodoMessage(messages: any[]): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.[TODO_MESSAGE_KEY] === true) {
      messages.splice(i, 1);
      return;
    }
  }
}
