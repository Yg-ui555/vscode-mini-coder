/**
 * 工具执行 —— 分批、并行/串行、回填结果
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐⭐ 三个必须做对的点，错了就是 provider 400
 *
 *   1. 【结果顺序必须和 tool_calls 顺序一致】
 *      OpenAI 协议要求 assistant 声明了 N 个 tool_call，
 *      就必须紧跟 N 条 tool 消息，且 tool_call_id 一一对应。
 *      Promise.all 的结果顺序是【按传入顺序】返回的，
 *      所以只要按原顺序传进去、按原顺序取出来就对了。
 *      但绝不能"谁先跑完谁先 push" —— 那会乱序。
 *
 *   2. 【写工具绝对不能并行】
 *      两个 apply_patch 改同一个文件 → 后写的覆盖先写的，
 *      而且 checkpoint 快照会乱。
 *      另外写工具要弹审批窗 —— 两个弹窗同时弹，用户懵了。
 *
 *   3. 【中断处理要更细】
 *      并行执行时用户点"停止"：
 *        · 已经在跑的 → 靠 signal 传给工具，让工具自己 abort
 *          （run_shell 靠这个杀子进程）
 *        · 还没开始的 → 补"[用户中断了本次任务，该工具未执行]"
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐⭐ 2026-10-22 关键修复：中断时必须补齐【剩余全部】tool_call
 *
 *   原来的写法只给"当前这一个" tc 补了中断说明就 return。
 *   但 LLM 一次可能返回多个 tool_calls（如 read_file + grep + list_dir），
 *   中断发生在第 2 个时，第 3 个永远不会有响应 —— 成了孤儿。
 *
 *   后果（生产级故障，不是理论问题）：
 *     1. 这份残缺结构被 SessionStore 原样写进 .jsonl
 *     2. 用户重开 VS Code，load() 读回来发给 provider
 *     3. provider 返回 400：
 *        "An assistant message with 'tool_calls' must be followed by
 *         tool messages responding to each tool_call_id"
 *     4. 对话永久卡死，只能删文件重来
 *
 *   触发条件：AI 一次叫多个工具时点"停止"。这是每天都在发生的高频操作。
 *
 *   为什么不能简单地"不要那条 tool_call 了"：
 *     如果那个工具可能已经产生了外部副作用（文件被删了、git push 发出去了），
 *     悄悄删掉记录会让模型以为没发生过，从而重做一遍 —— 从"做了一次"
 *     变成"做了两次"。所以必须显式告诉模型"这一步没执行完"。
 *
 *   配套的第二道保险在 util/historyRepair.ts（读会话时自愈），
 *   它负责救回磁盘上【已经存在的】坏记录。
 *
 * ─────────────────────────────────────────────────────────────
 * 大输出外置（2026-10-22）
 *
 *   ReAct 循环每一步都要重发全部上下文，所以"塞进上下文的东西"
 *   实际上会被重复发送十几次、几十次。评测数据显示输入 token
 *   是输出的 20 倍，根源就在这。
 *
 *   这里把超大输出落盘，回灌给 LLM 的是「头尾预览 + 文件路径」，
 *   LLM 需要细节时用 read_file 带 offset/limit 精准取。
 *
 *   为什么放在这里而不是各个工具内部：
 *     · 单一入口，9 个工具都不用改（跟 factory.ts 的思路一致：
 *       收拢到一个地方，避免"加个工具就忘了做这件事"）
 *     · 阈值策略只在这里维护一份
 *     · isError 的原始结果已经拿到了，外置不影响错误语义
 */

import { maybeExternalize } from '../toolOutputStore';
import { partitionToolCalls } from '../tools/partition';
import { getGuard } from '../tools/repeatGuard';
import { getDefaultCwd } from '../tools/paths';
import { getHookManager } from '../hooks/manager';
import { info } from '../../logger';
import { Operation, OperationResult, notApplicable, applied, yielded } from './types';
import { wrapUntrusted } from '../trust';

export const toolExecutionOperation: Operation = {
  name: 'tool_execution',

  async run(ctx): Promise<OperationResult> {
    const response = ctx.state.lastResponse;
    if (!response) return notApplicable();
    if (response.toolCalls.length === 0) return notApplicable();

    const toolCalls = response.toolCalls;

    // 必须把 assistant message 完整存下来（含 tool_calls），否则下一轮报 400
    ctx.messages.push({
      role: 'assistant',
      content: response.content || '',
      tool_calls: toolCalls.map((tc: any) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    const completed: Array<{ id: string; name: string }> = [];

    // ⭐ 过滤掉"本轮没广告过"的工具
    //
    //   ⚠️ 协议合法性：assistant 声明了 N 个 tool_call，就必须紧跟 N 条 tool 消息。
    //   所以被过滤掉的那些【也要补一条 tool 消息】（内容是"没执行"），
    //   不能直接丢掉 —— 丢了下一轮就是 400。
    const advertised = ctx.state.advertisedTools;
    const isAdvertised = (n: string): boolean => {
      if (!advertised) return true; // 没记录就放行（不因为埋点缺失而挡住正常流程）
      return advertised.includes(n);
    };

    const executable: typeof toolCalls = [];
    for (const tc of toolCalls) {
      if (isAdvertised(tc.name)) {
        executable.push(tc);
        continue;
      }
      ctx.messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content:
          `[已跳过] 工具 "${tc.name}" 本轮不可用（不在本轮提供给模型的工具清单中）。` +
          `请只用本轮清单里的工具。`,
      });
    }

    if (executable.length === 0) {
      // 全被过滤了 —— 本轮没有任何可执行的东西，直接进下一轮
      return applied();
    }

    const batches = partitionToolCalls(executable, ctx.registry);

    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const batchStartIndex = batches
          .slice(0, bi)
          .reduce((n, b) => n + b.calls.length, 0);

        // ── 中断检查（批次级别）──
        if (ctx.signal?.aborted) {
          // 先报告进度：让上层有机会把"哪些做完了"存成快照。
          // ⚠️ 必须在往 messages 里补中断说明【之前】报告，
          //    否则上层存的快照会包含这些还没 push 的"补位消息"，
          //    恢复时就分不清它们是真的执行过还是补上去的了。
          ctx.callbacks.onToolProgress?.({
            iteration: ctx.iteration,
            done: [...completed],
            pending: executable
              .slice(batchStartIndex)
              .map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })),
            finished: false,
          });

          // 补齐【剩余全部】tool_call（不只是当前批次）
          pushAbortedToolMessages(ctx.messages, executable, batchStartIndex);
          return yielded(ABORTED_MESSAGE);
        }

        // ── 解析参数（所有批次共用）──
        const parsed = batch.calls.map((tc) => {
          let args: any = {};
          try {
            args = JSON.parse(tc.arguments || '{}');
          } catch {
            args = {};
          }
          return args;
        });

        // ── 执行 ──
        let results: any[];
        if (batch.parallel) {
          // ⭐ 并行执行
          //   Promise.all 保证结果顺序 === 传入顺序（V8 规范保证），
          //   所以后面按顺序 push 就对了。
          //
          //   ⚠️ 注意 map 回调是 async 的，但 onToolCall 仍在第一个 await 之前，
          //     所以【上报顺序】和以前完全一样（map 按顺序同步调用回调）。
          results = await Promise.all(
            batch.calls.map(async (tc, idx) => {
              ctx.callbacks.onToolCall(tc.name, parsed[idx]);
              // ⭐ PreToolUse hook：可以否决这次工具调用
              const denial = await runPreToolUseHook(tc.name, parsed[idx], ctx.iteration);
              if (denial) return denial;
              return ctx.registry.execute(tc.name, parsed[idx], ctx.signal);
            }),
          );
        } else {
          // 串行执行（写/执行类工具）
          results = [];
          for (let idx = 0; idx < batch.calls.length; idx++) {
            const tc = batch.calls[idx];
            // 串行时每个工具执行前都要检查中断
            if (ctx.signal?.aborted) {
              ctx.callbacks.onToolProgress?.({
                iteration: ctx.iteration,
                done: [...completed],
                pending: executable
                  .slice(batchStartIndex + idx)
                  .map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })),
                finished: false,
              });
              pushAbortedToolMessages(ctx.messages, executable, batchStartIndex + idx);
              return yielded(ABORTED_MESSAGE);
            }
            ctx.callbacks.onToolCall(tc.name, parsed[idx]);
            // ⭐ PreToolUse hook：可以否决这次工具调用
            const denial = await runPreToolUseHook(tc.name, parsed[idx], ctx.iteration);
            if (denial) {
              results.push(denial);
              continue;
            }
            results.push(await ctx.registry.execute(tc.name, parsed[idx], ctx.signal));
          }
        }

        // ── 回填结果（严格按原顺序）──
        for (let idx = 0; idx < batch.calls.length; idx++) {
          const tc = batch.calls[idx];
          const result = results[idx];

          // ⭐ 大输出外置（2026-10-22）
          const { content: finalContent, stored } = maybeExternalize(tc.name, result.content, parsed[idx]);
          if (stored) {
            info(
              `[外置] ${tc.name} 输出 ${stored.originalChars} 字符 / ${stored.lines} 行 → ${stored.relPath}`,
            );
            // 告诉用户"它读了个大文件"，否则用户会以为 agent 卡住了
            ctx.callbacks.onText?.(
              `\n📄 ${tc.name} 输出过大（${stored.originalChars} 字符），` +
                `已存到 ${stored.relPath}，对话里只保留头尾预览。\n\n`,
            );
          }

          ctx.callbacks.onToolResult(
            tc.name,
            { content: finalContent, isError: result.isError },
            parsed[idx],
          );

          // ⭐ PostToolUse hook：工具跑完之后通知一下
          //   它【不能阻断】—— 它的定位是"通知型"（跑格式化、记审计日志）。
          await runPostToolUseHook(
            tc.name,
            parsed[idx],
            {
              content: finalContent,
              isError: result.isError,
            },
            ctx.iteration,
          );

          // ⭐ 写/执行类工具跑完后，让「外部查询计数」全部失效
          //
          //   原因：grep 的结果取决于整个工作区的状态。
          //   agent 改了文件之后再 grep 同样的 pattern，结果是不同的 ——
          //   这时再拦截它就是错的，会逼 agent 用过期的搜索结果做决策。
          //
          //   举例：agent grep "TODO" → 改了文件 → 又 grep "TODO"
          //        （这次多了一处 TODO）→ 这次必须放行。
          //
          //   借鉴 nanobot/agent/tools/file_state.py:76-78（写入即失效回执）
          if (!batch.parallel) {
            getGuard().invalidateQueryCounts();
          }

          // ⭐⭐ 不可信数据边界（提示注入防护）
          //
          //   这是【整个管线里唯一】给工具输出打边界标记的地方。
          //
          //   为什么放在这里而不是每个工具内部？
          //     · 单一收口 —— 加新工具的人不需要记得写，
          //       忘了就是安全漏洞（"靠人记住"的设计迟早会漏）
          //     · 覆盖全部工具 —— 包括 run_shell。
          //       恶意 README 的内容完全可以从 `cat README.md` 的
          //       命令输出进来，只包 read_file 是堵不住的
          //     · 工具契约保持干净 —— read_file 的契约就是"返回文件内容"
          //
          //   详见 src/agent/trust.ts 的文件头说明。
          //
          //   ⚠️ 注意 onToolResult 回调拿到的仍是【未包装】的原始内容 ——
          //      Webview 里给用户看的是干净结果，模型看到的是带标记的。
          ctx.messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: wrapUntrusted(finalContent),
          });

          // ⭐ 每完成一个工具就立刻上报进度
          //   必须在 messages.push 之后 —— 这样上层拿到的 "done" 一定是
          //   真的已经落进 messages 了，恢复时才不会误判成"未执行"。
          completed.push({ id: tc.id, name: tc.name });
          ctx.callbacks.onToolProgress?.({
            iteration: ctx.iteration,
            done: [...completed],
            pending: executable
              .slice(batchStartIndex + idx + 1)
              .map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })),
            // ⚠️ 这里永远是 false：还有下一轮循环在跑。
            //   finished 的语义是"【整个 run】结束"，不是"这批工具跑完"——
            //   否则上层会在第一轮就跑完时就清掉续跑快照，
            //   后面几轮中途崩溃就恢复不了了。
            finished: false,
          });
        }
      }

    return applied();
  },
};

/** 中断时给用户看的话 */
const ABORTED_MESSAGE =
  '[已中断] 任务被用户手动停止。上面已完成的部分保留在对话里，可以直接接着说下一步。';

/**
 * 补齐【剩余全部】tool_call（不只是当前这一个）
 *
 * 详见文件头注释里"2026-10-22 关键修复"那一段 ——
 * 这是会导致对话永久卡死（400）的高频故障。
 */
function pushAbortedToolMessages(
  messages: any[],
  toolCalls: Array<{ id: string; name: string }>,
  fromIndex: number,
): void {
  for (let j = fromIndex; j < toolCalls.length; j++) {
    const pending = toolCalls[j];
    messages.push({
      role: 'tool',
      tool_call_id: pending.id,
      content: '[用户中断了本次任务，该工具未执行]',
    });
  }
}

/**
 * PreToolUse —— 工具调用前
 *
 * @returns 被否决时返回一条错误结果（isError=true），否则 null
 *
 * ⚠️ 为什么被否决要当成【错误】而不是【成功但没结果】：
 *   工具"失败"时 LLM 会硬来，"成功但没新信息"时 LLM 才会停下来换策略。
 *   所以否决必须带上明确的原因，作为错误回给模型。
 *
 * ⭐⭐ 2026-10-26 修一个真实 bug：cwd 参数以前漏传了
 *   （原代码 `hooks.runPreToolUse(tool, args)` → cwd 是 undefined）。
 *   cwd 是 undefined 时 spawn 会【继承父进程的工作目录】——
 *   也就是 VS Code 扩展宿主进程的目录，不是用户打开的工作区。
 *   后果：用户配的 `npm test` 这类 hook 会在错误的目录里跑，
 *   测的可能是别的项目，或者直接报"找不到 package.json"。
 *   症状是"hook 好像没生效"，但没有任何报错 —— 极难排查。
 */
async function runPreToolUseHook(
  tool: string,
  args: any,
  iteration: number,
): Promise<{ content: string; isError: true } | null> {
  const hooks = getHookManager();
  if (!hooks.hasHooks) return null;

  const outcome = await hooks.runPreToolUse(tool, args ?? {}, getDefaultCwd(), iteration);
  if (outcome.problem) info(`[hook] PreToolUse: ${outcome.problem}`);
  if (!outcome.blocked) return null;

  return {
    content: outcome.reason ?? `[工具调用被 PreToolUse hook 拒绝：${tool}]`,
    isError: true,
  };
}

/**
 * PostToolUse —— 工具调用后（只通知，不阻断）
 *
 * ⭐⭐ 同样的 cwd 漏传 bug（原代码也没传 cwd）
 */
async function runPostToolUseHook(
  tool: string,
  args: any,
  result: { content: string; isError?: boolean },
  iteration: number,
): Promise<void> {
  const hooks = getHookManager();
  if (!hooks.hasHooks) return;

  const outcome = await hooks.runPostToolUse(tool, args ?? {}, result, getDefaultCwd(), iteration);
  if (outcome.problem) info(`[hook] PostToolUse: ${outcome.problem}`);
}
