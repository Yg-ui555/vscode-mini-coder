/**
 * Stop Hook —— agent 说"我做完了"，但 hook 说"不许结束"
 *
 * 这是整套 hook 机制最有价值的一个点。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它
 *
 *   AI 编程助手最典型的失败不是"没改对"，
 *   而是"它【声称】改好了，其实没改对"——
 *   而它自己是发现不了的：它跑一次测试看到绿色就收工了。
 *
 * ─────────────────────────────────────────────────────────────
 * 语义（抄 goose 的 ops_stop_hook.rs:80-119）
 *
 *   Stop hook 跑测试 → 退出码非 0 → 把失败信息回给模型
 *   → 模型继续干活 → 再跑一次
 *   → 连续 8 次都失败 → 强制放行（防死循环烧钱）
 *
 * ─────────────────────────────────────────────────────────────
 * 什么时候【不】适用
 *
 *   只有当 LLM 这一轮【没有】调工具（也就是它认为任务做完了）
 *   才轮到 Stop hook 说话。
 *   如果它还在调工具，那是 toolExecution 的活。
 */

import { getHookManager } from '../hooks/manager';
import { getDefaultCwd } from '../tools/paths';
import { info } from '../../logger';
import { Operation, OperationResult, notApplicable, applied, yielded } from './types';

export const stopHookOperation: Operation = {
  name: 'stop_hook',

  async run(ctx): Promise<OperationResult> {
    // 只有"这一轮没调工具"才轮到 Stop hook 说话
    const response = ctx.state.lastResponse;
    if (!response) return notApplicable();
    if (response.toolCalls.length > 0) return notApplicable();

    const hooks = getHookManager();
    if (!hooks.hasHooks) {
      // 没有 hook —— 但【仍然要收尾】：
      // 正常结束时要通知上层清掉续跑快照，否则中断续跑会误判成"还有半截任务"。
      ctx.callbacks.onToolProgress?.({
        iteration: ctx.iteration,
        done: [],
        pending: [],
        finished: true,
      });
      return yielded(response.content || '');
    }

    // ⭐⭐ 参数顺序必须是 (response, cwd, iteration)
    //
    //   ⚠️⚠️ 2026-10-26 修一个真实 bug：
    //   原来的代码写的是 `hooks.runStop(response.content || '', iteration)` ——
    //   而签名是 `runStop(response: string, cwd: string, iteration?: number)`。
    //   也就是说：轮次号被当成【工作目录】传了进去。
    //
    //   后果分两种：
    //     · 用户配的 Stop hook：spawn 的 cwd 是个数字 →
    //       Node 直接抛 ERR_INVALID_ARG_TYPE → hook 【从来没跑起来过】
    //     · 内置的 Stop 检查：回调忽略了 cwd 参数，所以侥幸没受影响
    //
    //   讽刺的是：单测没抓到，因为 hooks.test.ts 是直接调 manager.runStop()
    //   并传对参数的 —— 绕过了主循环这条路径。
    //   这正是"测试工具的 bug 比被测对象更可怕"的又一次现场演示。
    const outcome = await hooks.runStop(
      response.content || '',
      getDefaultCwd(),
      ctx.iteration,
    );
    if (outcome.problem) info(`[hook] Stop: ${outcome.problem}`);

    if (outcome.blocked) {
      // 把失败原因回给模型，让它继续干活
      ctx.messages.push({
        role: 'user',
        content: outcome.reason ?? '[Stop hook 拒绝结束回合，但没有给出原因]',
      });
      const firstLine = (outcome.reason ?? '').split('\n')[0];
      ctx.callbacks.onText?.(`\n⛔ ${firstLine}\n\n`);
      // ⭐ 不 yield —— 继续下一轮，让模型去修
      return applied();
    }

    // ⭐ 整个 run 正常结束 → 通知上层清掉续跑快照
    ctx.callbacks.onToolProgress?.({
      iteration: ctx.iteration,
      done: [],
      pending: [],
      finished: true,
    });
    return yielded(response.content || '');
  },
};
