/**
 * 上下文治理 —— 报用量 + 必要时压缩
 *
 * ─────────────────────────────────────────────────────────────
 * 这一步解决的是 agent 产品的生死线之一：上下文窗口
 *
 *   ReAct 循环每一步都要【重发全部上下文】，
 *   所以"塞进上下文的东西"实际上会被重复发送十几次、几十次。
 *   评测数据显示输入 token 是输出的 20 倍，根源就在这。
 *
 *   三个压缩手段（分层，各管一段）：
 *     · 双可见性    —— 压掉的历史标 agentVisible=false，请求前过滤（visibility.ts）
 *     · 分组保护    —— tool 消息永远不能被压掉（下面详述）
 *     · 大输出外置  —— 超大工具输出落盘，只回灌头尾预览（toolOutputStore.ts）
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐⭐ 压缩时最关键的一条：assistant + tool 必须当成【一个整体】
 *
 *   带 tool_calls 的 assistant 消息一旦被压进摘要，
 *   它对应的 tool 消息就成了【孤立 tool】—— 找不到任何 tool_call 声明过它。
 *   压缩后的结构长这样：
 *     [system] [摘要] [tool结果 tool结果 tool结果 ...] [最近的消息]
 *                        ↑ 全是孤儿，provider 直接 400
 *
 *   而且这个 bug 比"用户点停止"严重得多：
 *     · 中断 bug 要用户主动点停止才触发
 *     · autocompact 在【任何长对话里必然触发】（阈值 = 上下文窗口 70%）
 *   也就是说，用户聊得越久、越信任这个工具，就越容易撞上。
 *
 *   正确做法：把 assistant + 它后面所有 tool 消息当成【一个整体】保护，
 *   绝不拆散。协议要求它们必须紧邻，拆了就非法。
 *
 * ─────────────────────────────────────────────────────────────
 * 压缩触发阈值：占上下文窗口的比例
 *
 *   借鉴 goose：crates/goose/src/context_mgmt/mod.rs:243 的
 *   check_if_compaction_needed 用 usage_ratio > 0.7 触发，默认 0.7。
 *   留 30% 余量是因为一次工具调用可能就要塞进几万 token 的结果，
 *   压到刚好卡线再触发就晚了。
 */

import { estimateMessagesTokens } from '../../util/tokens';
import { filterForModel, refreshVisibleCallIds } from '../visibility';
import { info } from '../../logger';
import { Operation, OperationResult, applied } from './types';

/** 压缩触发阈值：占上下文窗口的比例 */
const COMPACT_THRESHOLD_RATIO = 0.7;

/**
 * 压缩后至少保留最近多少条【对话】消息
 *
 * ⚠️ 2026-10-21 修复：原来这里是"保留最近 6 条【所有】消息"。
 *   长工具链跑起来后，最近 6 条很可能正好把「上一步 apply_patch 的结果」
 *   挤出去 → LLM 看不见自己刚改了什么 → 重复改同一个文件。
 *
 *   现在改成两条规则叠加：
 *     1. 永远保住所有 tool 消息（哪怕它很靠前）—— 它们是"我干了什么"的唯一记录
 *     2. 对话消息至少保留最近 KEEP_RECENT_MESSAGES 条
 */
const KEEP_RECENT_MESSAGES = 12;

export const contextGuardOperation: Operation = {
  name: 'context_guard',

  async run(ctx): Promise<OperationResult> {
    // ⭐ 2026-10-21 改用 token 计数
    //   原来是数字符（COMPACT_THRESHOLD_CHARS = 80000），
    //   但 token ≠ 字符：同样 8 万字符，全英文约 2 万 token，
    //   全中文约 6 万 token，误差 3 倍。估少了白丢历史，
    //   估多了会被 API 直接 400 拒绝、整轮对话崩掉。
    //
    //   现在按【上下文窗口的使用比例】触发（借鉴 goose 的 0.7），
    //   并且中英文分开估算（见 util/tokens.ts）。
    //
    // ⭐ 双可见性：必须用【过滤后】的消息算。
    //   否则会把「模型看不见但用户还看得到」的历史也算进去 ——
    //   那部分根本不占模型的上下文窗口。算虚高会导致【过早触发压缩】，白白丢历史。
    const visible = filterForModel(ctx.messages);
    const totalTokens = estimateMessagesTokens(visible, ctx.registry.schemas);
    const threshold = Math.floor(ctx.contextWindow * COMPACT_THRESHOLD_RATIO);

    // 每轮都把用量报给 UI，让用户看得见"还剩多少"
    ctx.callbacks.onUsage?.(totalTokens, ctx.contextWindow);

    if (totalTokens < threshold) return applied();

    // ── 到这里才真的需要压缩 ──────────────────────────────
    await compress(ctx, threshold);

    return applied();
  },
};

/** 真正的压缩流程 */
async function compress(
  ctx: {
    messages: any[];
    signal?: AbortSignal;
    callbacks: { onCompact?: (s: string) => void; onText?: (c: string) => void };
    provider: { stream: (m: any[], t: any[], s?: AbortSignal) => AsyncGenerator<any> };
  },
  _threshold: number,
): Promise<void> {
  const messages = ctx.messages;

  // 切分：system + [要总结的] + [保留最近的]
  const systemIdx = messages[0]?.role === 'system' ? 0 : -1;
  const startIdx = systemIdx >= 0 ? 1 : 0;
  const endIdx = messages.length - KEEP_RECENT_MESSAGES;

  if (endIdx <= startIdx + 1) return; // 没东西可压缩

  // ⚠️ 这里不提前切出 toSummarize —— 分组时必须按
  //   「assistant + 它后面所有 tool 消息」为一组遍历，
  //   预先 slice 反而会把一组拆开，那正是上面注释里说的那个 400 bug。
  const recent = messages.slice(endIdx);

  // ⭐ 关键修复：tool 消息【永远不能被压缩掉】
  //   tool 消息记录的是"我实际改了什么、命令返回了什么"。
  //   一旦压缩掉，LLM 就失去了对自己行为的记忆，会重复改同一个文件。
  const protectedMessages: any[] = [];
  const summarizable: any[] = [];

  let cursor = startIdx;
  while (cursor < endIdx) {
    const m = messages[cursor];

    // ⭐⭐ 钉住的消息（pinned: true）永远不参与压缩
    //
    //   比喻：会议室墙上那张"本季度目标"的白板 ——
    //   保洁擦桌子的时候不会把它擦掉，因为它不是"历史记录"，
    //   它是"当前状态"。
    //
    //   哪些消息需要钉住：
    //     · 待办清单（todoInject 注入的 __todo_state）
    //       —— 它是"我走到第几步了"的唯一真相。
    //       不钉住的话：压缩会把它标成 agentVisible=false，
    //       而 filterForModel 会把这类消息【永久】过滤掉 ——
    //       模型从此再也看不到待办状态，多步任务必然从头再来。
    //       （这正是 Phase 5.1 的核心验收点："压缩后 todo 还在"）
    //     · 用户插话（steerInject 注入的）
    //       —— 用户的最新指令不能被压掉
    //
    //   为什么做成【通用机制】而不是给待办单独开个特例：
    //     pinned 不跟具体功能耦合。以后再加"系统级常驻上下文"之类的能力，
    //     只要打上 pinned 就能自动受保护，不用改压缩逻辑。
    if (m?.pinned === true) {
      protectedMessages.push(m);
      cursor++;
      continue;
    }

    const isToolCallingAssistant =
      m?.role === 'assistant' &&
      Array.isArray(m.tool_calls) &&
      m.tool_calls.length > 0;

    if (isToolCallingAssistant) {
      // 整体保护：assistant 本体 + 紧随其后的全部 tool 消息
      protectedMessages.push(m);
      let k = cursor + 1;
      while (k < endIdx && messages[k]?.role === 'tool') {
        protectedMessages.push(messages[k]);
        k++;
      }
      cursor = k;
      continue;
    }

    if (m?.role === 'tool') {
      // 没有对应 assistant 的残留 tool（理论上不该有，有 historyRepair 兜底）
      // 照样保护：宁可不压也不能丢
      protectedMessages.push(m);
      cursor++;
      continue;
    }

    // 纯对话消息（user / 无工具调用的 assistant / system 片段）
    summarizable.push(m);
    cursor++;
  }

  if (summarizable.length === 0) {
    // 全是 tool 消息，宁可不压也不能丢
    return;
  }

  // ⭐ 2026-10-24 双可见性：只总结【当前模型还看得见】的消息
  //
  //   为什么必须过滤：
  //     上一次压缩时，旧的原始对话已经被打上 agentVisible=false，
  //     但它们【仍然留在 messages 里】（这是双可见性的核心 —— 用户还能回看）。
  //
  //     如果不把它们排除掉：
  //       · 摘要 prompt 会把同一批历史再塞一遍（重复劳动）
  //       · 更糟的是：上一轮的【摘要消息本身】也会被再次总结，
  //         导致摘要套摘要、越滚越长、越滚越失真
  //
  //   这是双可见性带来的新情况 —— 原来（原地重排）不存在这个问题，
  //   因为被压掉的消息已经不在 messages 里了。
  const visibleSummarizable = summarizable.filter((m) => m?.agentVisible !== false);

  if (visibleSummarizable.length === 0) {
    // 全是已经压过的历史 —— 没什么新的可总结
    return;
  }

  // 构造总结 prompt
  const transcriptText = visibleSummarizable
    .map((m) => {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      const tools = m.tool_calls
        ? ` [调用工具: ${m.tool_calls.map((tc: any) => tc.function?.name).join(', ')}]`
        : '';
      return `[${m.role}]${tools}: ${c.slice(0, 800)}`;
    })
    .join('\n\n');

  const summaryPrompt = `请把以下 agent 对话历史总结成简洁的要点，保留：
- 用户的核心需求和偏好
- 已修改的文件路径 + 修改内容
- 关键决策和发现
- 测试结果（如有）

少于 1500 字，用 Markdown 列表形式。

对话历史：
${transcriptText}`;

  let summary = '';
  try {
    for await (const chunk of ctx.provider.stream(
      [{ role: 'user', content: summaryPrompt }],
      [],  // 总结时不传 tools，避免 LLM 又想调工具
      ctx.signal,
    )) {
      if (chunk.content) summary += chunk.content;
      if (chunk.isFinal) break;
    }
  } catch {
    // 总结失败静默跳过
    return;
  }

  if (!summary.trim()) return;

  // 标记：被压缩掉的原始消息 → 模型看不见，用户仍可见
  for (const m of summarizable) {
    m.agentVisible = false;
  }

  // 摘要消息：只给模型看（用户不需要看技术摘要）
  const summaryMessage = {
    role: 'system',
    content: `[Earlier conversation summary — autocompact triggered at ${messages.length} messages]\n\n${summary.trim()}`,
    agentVisible: true,
    userVisible: false,
  };

  // ⭐ 组装新的 messages：顺序是
  //   [原 system] [摘要] [被隐藏的原始对话] [受保护的 tool 消息] [最近的消息]
  //
  //   注意【被隐藏的原始对话】要放回来 —— 这是双可见性的核心。
  //   放回原位，保证 tool_call / tool 消息的相对顺序不变。
  const newMessages: any[] = [];
  if (systemIdx >= 0) newMessages.push(messages[0]);  // 保留原 system
  newMessages.push(summaryMessage);
  newMessages.push(...summarizable);           // ⭐ 打上了 agentVisible=false
  // ⭐ 被保护的工具消息按原顺序放回（它们比摘要更权威 ——
  //   摘要可能漏掉细节，但工具结果是客观事实）
  newMessages.push(...protectedMessages);
  newMessages.push(...recent);

  // ⭐ 压完后补一条"继续"指令
  //   没有这条的话，LLM 拿到一段摘要后常常会"忘了自己正在干嘛"，
  //   要么停下来问用户，要么从头再来一遍。
  //   借鉴 nanobot 的 context_governance.py:574 —— 压缩后明确告诉它继续。
  newMessages.push({
    role: 'user',
    content:
      `[系统提示：上面的对话历史因为过长被压缩成了一段摘要，工具调用记录仍完整保留。` +
      `请基于摘要和工具记录继续完成你之前正在做的任务，不要重新开始，也不要询问用户是否要继续。]`,
  });

  messages.length = 0;
  messages.push(...newMessages);

  // ⭐ 压缩后必须重算「当前可见的 tool_call_id 集合」
  //   重复检测的第四重校验（"原结果是否还在上下文里"）依赖这个集合。
  refreshVisibleCallIds(messages);

  info(
    `[autocompact] ${summarizable.length} 条对话 → 1 段总结` +
      `（保住 ${protectedMessages.length} 条工具记录 + ${recent.length} 条最近消息）`,
  );

  ctx.callbacks.onCompact?.(
    `🔄 autocompact：${summarizable.length} 条对话 → 1 段总结` +
      `（保住 ${protectedMessages.length} 条工具记录 + ${recent.length} 条最近消息；` +
      `被压缩的历史仍可回看）`,
  );
}
