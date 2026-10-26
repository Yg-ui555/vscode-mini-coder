/**
 * 迭代触顶 —— 强制收尾
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么要单独做成一个 Operation
 *
 *   触顶不是"错误"，是一种【必须优雅处理的状态】。
 *   如果只是 `if (iteration >= max) return '[超限]'`，用户看到的就是一句没用的报错。
 *
 *   正确的做法是：再发一次【不带工具】的请求，让 LLM 把已经做的工作总结给用户。
 *
 *   类比：
 *     员工被要求"今天必须收工"，但活没干完。
 *     差的做法：直接说"时间到了"就走了。
 *     好做法：让他交一份"干到哪了、卡在哪、您接着做什么"的交接单。
 *
 *   借鉴 nanobot runner.py:1168 的 _try_finalize_after_max_iterations
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 收尾请求【不注册工具】
 *
 *   带工具的话，LLM 可能又想调工具，收尾就收不住 ——
 *   无限循环，而且每次都烧 token。
 *   （对应测试：agentLoop.test.ts 断言 provider.lastToolsArg === []）
 */

import { filterForModel } from '../visibility';
import { Operation, OperationResult, notApplicable, yielded } from './types';

export const maxIterationsOperation: Operation = {
  name: 'max_iterations',

  async run(ctx): Promise<OperationResult> {
    if (ctx.iteration < ctx.maxIterations) return notApplicable();

    const summary = await finalizeWithoutTools(ctx);

    // 触顶收尾也算 run 正常结束（此时没有未完成的工具）
    ctx.callbacks.onToolProgress?.({
      iteration: ctx.maxIterations - 1,
      done: [],
      pending: [],
      finished: true,
    });

    return yielded(summary);
  },
};

/**
 * 触顶收尾：发一次【不带工具】的请求，让 LLM 总结进度
 *
 * 为什么重要：
 *   用户看到的如果只是"[已达到最大迭代次数 20]"，他完全不知道 AI 干了什么、
 *   改了什么、下一步该干嘛 —— 这是最让人抓瞎的结局。
 *   加一次无工具总结，至少能拿到一份可读的进度报告。
 */
async function finalizeWithoutTools(ctx: {
  messages: any[];
  signal?: AbortSignal;
  callbacks: { onText: (c: string) => void };
  provider: { stream: (m: any[], t: any[], s?: AbortSignal) => AsyncGenerator<any> };
  maxIterations: number;
}): Promise<string> {
  const notice =
    `\n\n[系统提示：你已达到本轮最大工具调用次数（${ctx.maxIterations}）。` +
    `请不要再调用任何工具，直接用中文总结：\n` +
    `1. 已经完成了什么（列出改过的文件）\n` +
    `2. 遇到了什么问题\n` +
    `3. 建议用户下一步做什么]`;

  // 末尾补一条 user 消息触发总结（不带工具 → LLM 只能输出文本）
  ctx.messages.push({ role: 'user', content: notice });

  let summary = '';
  try {
    // ⭐ 双可见性：触顶收尾也要用过滤后的消息
    //   （被压缩掉的历史不该在收尾总结里重新冒出来）
    for await (const chunk of ctx.provider.stream(filterForModel(ctx.messages), [], ctx.signal)) {
      if (chunk.content) {
        summary += chunk.content;
        ctx.callbacks.onText(chunk.content);
      }
      if (chunk.isFinal) break;
    }
  } catch (e: any) {
    // 总结失败也要给用户交代，不能静默
    return summary || `[已达到最大迭代次数 ${ctx.maxIterations}，且无法生成总结：${e?.message || e}]`;
  }

  return summary || `[已达到最大迭代次数 ${ctx.maxIterations}]`;
}
