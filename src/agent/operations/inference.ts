/**
 * 推理 —— 调一次 LLM
 *
 * ─────────────────────────────────────────────────────────────
 * 这个 Operation 干的事很单纯：把消息发给 LLM，把响应记下来
 *
 * 但有三件事必须做对，错了就是 400 或者烧钱：
 *
 *   1. 【发给 provider 的必须是过滤后的消息】
 *      被压缩掉的历史（agentVisible=false）不再重发。
 *      这是 token 下降的来源。
 *      ⚠️ estimateMessagesTokens 也要用过滤后的结果算，
 *      否则 UI 上的"上下文用量"显示的是含隐藏消息的虚高数字。
 *
 *   2. 【tool_calls 必须原样存进 assistant 消息】
 *      少存了，下一轮 provider 直接报：
 *        "An assistant message with 'tool_calls' must be followed by
 *         tool messages responding to each tool_call_id"
 *
 *   3. 【usage 必须【在 delta 判断之前】解析】
 *      OpenAI 兼容协议在流式结束时会多发一个
 *      { choices: [], usage: {...} } 的 chunk，
 *      那个 chunk 没有 delta —— 先判 delta 就会把它整个丢掉，用量永远拿不到。
 *      （这个 bug 在 provider.ts 里已经修过，这里只是提醒别改回去）
 *
 * ─────────────────────────────────────────────────────────────
 * 空响应处理
 *
 *   provider 偶发返回空的 completion（网络抖动、网关抽风）。
 *   硬报错的话用户一脸懵，agent 也直接罢工。
 *   这里重试最多 3 次（指数退避），仍失败才报错。
 *
 *   借鉴 goose 的 ops_empty_response.rs / inference.rs:77-91
 */

import { LLMResponse } from '../provider';
import { filterForModel, refreshVisibleCallIds } from '../visibility';
import { Operation, OperationResult, notApplicable, applied, yielded } from './types';

/** 空响应重试次数 */
const EMPTY_RESPONSE_RETRIES = 3;

export const inferenceOperation: Operation = {
  name: 'inference',

  async run(ctx): Promise<OperationResult> {
    // ⭐ 双可见性：发给 provider 的必须是【过滤后】的消息
    const modelMessages = filterForModel(ctx.messages);

    let finalResponse: LLMResponse | null = null;

    for (let attempt = 0; attempt <= EMPTY_RESPONSE_RETRIES; attempt++) {
      if (attempt > 0) {
        // 退避后重试：流被截断（没吐出 final 块）多半是瞬时的，等一下比直接失败好
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 4000));
        if (ctx.signal?.aborted) {
          return yielded('[已中断] 任务被用户手动停止。');
        }
      }

      // ⚠️ 每次重试都要从头累积
      finalResponse = null;
      let gotContent = false;

      for await (const chunk of ctx.provider.stream(modelMessages, ctx.registry.schemas, ctx.signal)) {
        if (chunk.isFinal && chunk.finalResponse) {
          finalResponse = chunk.finalResponse;
          // ⭐ 累加本轮 usage（流末尾那个 chunk 才有）
          if (chunk.usage) {
            ctx.state.tokenTotal.promptTokens += chunk.usage.promptTokens;
            ctx.state.tokenTotal.completionTokens += chunk.usage.completionTokens;
            ctx.state.tokenTotal.totalTokens += chunk.usage.totalTokens;
            ctx.callbacks.onTokenUsage?.(chunk.usage, { ...ctx.state.tokenTotal });
          }
        } else if (chunk.content) {
          gotContent = true;
          ctx.callbacks.onText(chunk.content);
        }
      }

      // ⚠️⭐ 重试的判据是【流有没有吐出 final 块】，不是【内容空不空】
      //
      //   · 没吐出 final 块 = 流被截断（网络断了、网关抽风）→ 值得重试
      //   · 吐出了 final 块但内容是空的 = 模型自己选择不说话
      //     （有些模型收尾时就会这样）→ 这不是故障，重试只会白烧 3 次钱
      //
      //   这个区分很重要：把第二种情况也重试，等于每次正常收尾都多花 3 次请求。
      if (finalResponse) break;
      if (gotContent) break; // 有内容但没有 final 块 —— 也不重试，交给下面报错
    }

    if (ctx.signal?.aborted) {
      return yielded('[已中断] 任务被用户手动停止。');
    }

    if (!finalResponse) {
      return yielded('[错误] LLM 未返回有效响应');
    }

    ctx.state.lastResponse = finalResponse;

    // ⭐ 记录"本轮实际广告给 LLM 的工具清单"
    //
    //   借鉴 goose 的 request_was_advertised
    //   （crates/goose/src/agents/state_machine/ops_toolcalling.rs:729-755）
    //
    //   goose 靠这条挡掉"历史消息里残留的旧 tool_call 被重放"。
    //   ⚠️ 诚实地说：在本项目的架构里这个风险【本来就小】——
    //      我们的 toolExecution 只处理"本轮刚拿到的 lastResponse"，
    //      从不回头扫历史消息，所以不存在"重放"这条路。
    //
    //   但这条检查在本项目仍然值得做，理由是【架构不变量】：
    //     将来如果加"按轮次动态裁剪工具"的能力
    //     （比如"未获批准时这一轮只给只读工具"），
    //     工具【仍然是注册过的】，registry 层的检查抓不到，
    //     只有"本轮有没有广告过它"这条能抓到。
    //
    //   比喻：门禁卡除了查"你是不是员工"（registry 层的检查），
    //         还要查"你今天有没有被授权进这扇门"（本轮广告清单）。
    ctx.state.advertisedTools = ctx.registry.schemas.map((s: any) => s.function.name);

    // ⭐ 刷新「模型可见的 tool_call_id 集合」
    //   重复检测的第四重校验依赖这个集合。
    //   每轮都刷（而不是只在压缩后刷），因为工具结果会不断新增。
    refreshVisibleCallIds(ctx.messages);

    return applied();
  },
};

/** 睡一会儿（Promise 版的 setTimeout） */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
