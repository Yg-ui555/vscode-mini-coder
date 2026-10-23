/**
 * 对话历史自愈（history repair）
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么要这个模块：OpenAI 兼容协议的一条硬性约束
 * ─────────────────────────────────────────────────────────────
 *
 *   协议规定：
 *     1. 每一条 assistant 消息里的【每个 tool_call】，后面必须有且仅有一条
 *        tool 消息来回应（用 tool_call_id 配对）。
 *     2. tool 消息必须【紧跟】在它所回应的 assistant 消息之后，
 *        不能凭空出现，也不能跨越其他消息。
 *
 *   违反任何一条，provider 会直接返回 400，整轮对话作废：
 *     "An assistant message with 'tool_calls' must be followed by tool messages
 *      responding to each tool_call_id"
 *
 * ─────────────────────────────────────────────────────────────
 * 坏数据是怎么产生的（这是本项目真实踩过的坑）
 * ─────────────────────────────────────────────────────────────
 *
 *   loop.ts 的工具执行循环里，用户点"停止"时只给【当前这一个】
 *   tool_call 补了中断说明，然后直接 return。
 *
 *   如果 LLM 一次返回了 3 个 tool_calls，而中断发生在第 2 个：
 *     · 第 1 个 → 正常执行，有响应 ✅
 *     · 第 2 个 → 补了中断说明 ✅
 *     · 第 3 个 → 【永远不会有响应】 ❌  ← 孤儿
 *
 *   这份残缺结构被 SessionStore 原样写进 .jsonl。
 *   用户下次打开 VS Code，load() 把它读回来发给 provider → 400 → 对话永久卡死。
 *
 * ─────────────────────────────────────────────────────────────
 * 两层防御（为什么两个都要有，缺一不可）
 * ─────────────────────────────────────────────────────────────
 *
 *   第1 层（治本）：loop.ts 中断时补齐【剩余全部】tool_call，不产生坏数据。
 *   第 2 层（治旧）：本模块，读会话时自愈。
 *
 *   第 2 层为什么不能省：
 *     · 用户磁盘上【已经存在】的坏会话文件不会自己变好
 *     · 评测历史 / 用户报 bug 附带的会话片段可能就是坏的
 *     · 别的模块（比如未来的 MCP 工具超时被杀）也可能造出同样的孤儿
 *
 *   只修第 1 层的话：老用户依然会撞 400，而且没有任何线索能查。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 关键设计决策：为什么不直接删掉没响应的 tool_call？
 * ─────────────────────────────────────────────────────────────
 *
 *   nanobot 的 recovery.py 里有一句话说得极好，值得照抄这个思路：
 *
 *     "silently dropping a malformed tool result could make the model
 *      repeat an external side effect"
 *
 *   翻译成人话：如果某个工具可能已经产生了【外部副作用】
 *   （git push 已经发出去了、文件已经被删了、邮件已经发了），
 *   而我们只是悄悄把它的调用记录删掉，模型看到"没有这回事"，
 *   下一步很可能【再做一遍】—— 那就从"没做"变成"做了两次"。
 *
 *   所以正确做法是：补一条明确的"这一步没执行完"，让模型知道发生了什么，
 *   由它自己决定要不要重试。
 *
 *   这是本模块的核心原则：【宁可显式告诉模型"这里断了"，也不要假装无事发生】。
 */

/** 给孤儿 tool_call 补的默认响应内容 */
const ORPHAN_TOOL_CONTENT =
  '[该工具调用没有执行结果。它可能是在任务被中断时未执行，' +
  '也可能是在早期版本中因缺陷丢失。如果它的结果对你当前的任务是必需的，' +
  '请重新调用该工具，不要假定它已经成功。]';

/** 给孤立 tool 消息替换的内容（配合合成 assistant 声明一起使用） */
const STRAY_TOOL_CONTENT =
  '[这次工具调用没有留下结果。它可能发生在对话历史被压缩时，' +
  '也可能发生在旧版本的一个缺陷下（原因为某次任务被强制中断）。' +
  '请不要假定它已经执行过；如果它的结果对你当前的任务是必需的，请重新调用。]';

/**
 * 合成 assistant 声明里用的假工具名
 *
 * 刻意取一个不像真工具的名字：模型看到 "interrupted_tool_call" 就知道
 * 这是一条修复产物，而不是它自己真的调用过的工具。
 */
const SYNTHETIC_TOOL_NAME = 'interrupted_tool_call';

export interface RepairResult {
  /** 修复后的消息数组（永远是新数组，不改原数组） */
  messages: any[];
  /** 补了多少条孤儿 tool_call 的响应 */
  filledOrphans: number;
  /** 为多少条孤立 tool 消息补了合成声明 */
  handledStrays: number;
  /** 丢掉了多少条连 tool_call_id 都没有的 tool 消息 */
  droppedNoId: number;
  /** 是否发生过任何修复 */
  changed: boolean;
  /** 一句话描述（写日志用） */
  summary: string;
}

/** 空结果（没需要修的东西时返回，省得调用方每次都判空） */
function noChange(messages: any[]): RepairResult {
  return {
    messages,
    filledOrphans: 0,
    handledStrays: 0,
    droppedNoId: 0,
    changed: false,
    summary: '无需修复',
  };
}

/**
 * 修复对话历史，返回协议合法的消息序列
 *
 * 处理四类问题：
 *   1. 孤儿 tool_call：assistant 声明了 N 个工具调用，只跟了 M<N 条响应 → 补齐 N-M 条
 *   2. 孤立 tool 消息：tool_call_id 找不到声明 → 补一条【合成 assistant 声明】兜住它
 *   3. 无主 tool 消息：连 tool_call_id 都没有 → 丢弃（无追溯性，纯噪声）
 *   4. 错位：tool 消息没紧跟在它所回应的 assistant 之后 → 重建顺序
 *
 * ⚠️ 纯函数，不碰文件、不碰 vscode、不抛异常（历史坏了也不能让面板打不开）。
 *
 * @param input 原始 messages（不会被修改）
 */

/**
 * 修复对话历史，返回协议合法的消息序列
 *
 * 处理三类问题：
 *   1. 孤立 tool 消息：tool_call_id 找不到对应的 tool_call → 替换为说明性内容
 *   2. 孤儿 tool_call：assistant 声明了 N 个工具调用，只跟了 M<N 条响应 → 补齐 N-M 条
 *   3. 错位：tool 消息没有紧跟在它所回应的 assistant 之后 → 重建顺序
 *
 * ⚠️ 纯函数，不碰文件、不碰 vscode、不抛异常（历史坏了也不能让面板打不开）。
 *
 * @param input 原始 messages（不会被修改）
 */
export function repairMessages(input: any[]): RepairResult {
  if (!Array.isArray(input) || input.length === 0) {
    return noChange(Array.isArray(input) ? input : []);
  }

  // ── 第 1 步：收集所有"合法"的 tool_call_id ──
  // 只有在 assistant 消息里真实声明过的 id 才算数
  const declaredIds = new Set<string>();
  for (const m of input) {
    if (m?.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (tc && typeof tc.id === 'string' && tc.id) declaredIds.add(tc.id);
      }
    }
  }

  if (declaredIds.size === 0 && !input.some((m) => m?.role === 'tool')) {
    // 没有任何工具调用痕迹 —— 纯对话，不用动
    return noChange(input);
  }

  // ── 第 2 步：丢掉"连调用身份都没有"的 tool 消息 ──
  //
  // 这跟下一节要处理的"有 id 但无声明"是两回事：
  //   没有 tool_call_id，就无法把这个结果对应到任何一次具体行为上，
  //   留在上下文里对模型是纯噪声（只会白占 token 并干扰判断）。
  //   而有 id 的情况保留了可追溯性，要另外想办法，不能就这么丢。
  let droppedNoId = 0;
  const stage1: any[] = [];
  for (const m of input) {
    if (m?.role === 'tool') {
      const id = m.tool_call_id;
      if (typeof id !== 'string' || !id) {
        droppedNoId++;
        continue;
      }
    }
    stage1.push(m);
  }

  // ── 第 3 步：重建结构，保证协议合法 ──
  //
  // ⭐ 核心认知（这里踩过一次坑才想明白）：
  //
  //   【光把孤立 tool 消息的内容换成说明是没有用的。】
  //   协议校验的是 tool_call_id 有没有对应的 tool_call 声明，
  //   跟内容写成什么毫无关系。所以"替换内容"这种做法修不了问题，
  //   改完之后它依然是一条孤立 tool 消息，provider 照样 400。
  //
  //   唯一既能保留信息、又协议合法的做法是：
  //   【在这些 tool 消息前面补一条合成的 assistant 声明】，
  //   把它们的 id 声明出去。结构变成：
  //
  //     [assistant(tool_calls=[ghost])]   ← 合成补上
  //     [tool(ghost, "这条调用没有结果…")]  ← 原来的，保留可追溯性
  //
  //   模型看到的就是"这里有一次调用，但结果断了"，
  //   由它自己判断要不要重来 —— 而不是"什么都没有发生过"。
  const out: any[] = [];
  let filledOrphans = 0;
  let handledStrays = 0;

  let i = 0;
  while (i < stage1.length) {
    const m = stage1[i];

    const isToolCallingAssistant =
      m?.role === 'assistant' &&
      Array.isArray(m.tool_calls) &&
      m.tool_calls.some((tc: any) => tc && typeof tc.id === 'string' && tc.id);

    // ── 情况 A：正常的 assistant + 它的 tool 响应（补齐缺失的）──
    if (isToolCallingAssistant) {
      out.push(m);

      // 按【声明顺序】收集并输出，保证结果顺序可预测
      const order: string[] = [];
      const seen = new Set<string>();
      for (const tc of m.tool_calls) {
        if (tc && typeof tc.id === 'string' && tc.id && !seen.has(tc.id)) {
          seen.add(tc.id);
          order.push(tc.id);
        }
      }

      // 紧随其后的 tool 消息（协议要求必须紧邻，不能跨越其他消息）
      const existing = new Map<string, any>();
      let j = i + 1;
      while (j < stage1.length && stage1[j]?.role === 'tool') {
        const id = stage1[j].tool_call_id;
        if (typeof id !== 'string' || !seen.has(id)) break; // 不属于这批，停
        if (!existing.has(id)) {
          existing.set(id, stage1[j]);
        }
        j++;
      }

      // ⭐ 补齐缺失的响应 —— 这是修 400 的关键动作
      //
      //   注意这里【按声明顺序统一输出】，而不是"先输出已有的、再补缺失的"。
      //   后者会让顺序变成 [x2(原有), x1(补的)] —— 合法但反直觉，
      //   以后读日志排查时对不上号。按声明顺序走，
      //   输出顺序永远等于 LLM 当初请求的顺序，可预测性更好。
      for (const id of order) {
        if (existing.has(id)) {
          out.push(existing.get(id));
        } else {
          out.push({
            role: 'tool',
            tool_call_id: id,
            content: ORPHAN_TOOL_CONTENT,
          });
          filledOrphans++;
        }
      }

      i = j;
      continue;
    }

    // ── 情况 B：一串"有 id 但无声明"的孤立 tool 消息 ──
    // autocompact 把 assistant 压成摘要之后，剩下的一整片 tool 结果就是这种形状
    if (m?.role === 'tool') {
      const strays: any[] = [];
      let j = i;
      while (
        j < stage1.length &&
        stage1[j]?.role === 'tool' &&
        !declaredIds.has(stage1[j].tool_call_id)
      ) {
        strays.push(stage1[j]);
        j++;
      }

      if (strays.length > 0) {
        // 补合成声明，让它们在协议上有出处
        out.push({
          role: 'assistant',
          content: '',
          tool_calls: strays.map((s) => ({
            id: s.tool_call_id,
            type: 'function',
            function: { name: SYNTHETIC_TOOL_NAME, arguments: '{}' },
          })),
          // 自定义标记：让 Webview / 调试时能认出这是修复产物，不是真实对话
          _synthetic: true,
        });

        for (const s of strays) {
          out.push({ ...s, content: STRAY_TOOL_CONTENT });
          handledStrays++;
        }
      }

      i = j;
      continue;
    }

    // ── 情况 C：普通消息（原样保留）──
    out.push(m);
    i++;
  }

  const changed = filledOrphans > 0 || handledStrays > 0 || droppedNoId > 0;
  const parts: string[] = [];
  if (filledOrphans) parts.push(`补齐 ${filledOrphans} 条孤儿工具响应`);
  if (handledStrays) parts.push(`为 ${handledStrays} 条孤立工具结果补上出处声明`);
  if (droppedNoId) parts.push(`丢弃 ${droppedNoId} 条无 tool_call_id 的无效工具结果`);

  return {
    messages: out,
    filledOrphans,
    handledStrays,
    droppedNoId,
    changed,
    summary: changed ? parts.join('，') : '无需修复',
  };
}

/**
 * 校验一段历史是否符合协议（给测试和 /doctor 用）
 *
 * @returns null 表示合法；否则返回人类可读的问题描述
 */
export function validateMessages(messages: any[]): string | null {
  if (!Array.isArray(messages)) return 'messages 不是数组';

  const declared = new Set<string>();
  for (const m of messages) {
    if (m?.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (tc?.id) declared.add(tc.id);
      }
    }
  }

  const answered = new Set<string>();
  for (const m of messages) {
    if (m?.role !== 'tool') continue;
    const id = m.tool_call_id;
    if (typeof id !== 'string' || !declared.has(id)) {
      return `孤立 tool 消息：tool_call_id=${id ?? '(空)'} 找不到对应的 tool_call`;
    }
    if (answered.has(id)) {
      return `tool_call_id=${id} 有多条响应（协议要求有且仅有一条）`;
    }
    answered.add(id);
  }

  const missing = [...declared].filter((id) => !answered.has(id));
  if (missing.length > 0) {
    return `孤儿 tool_call（缺少响应）：${missing.join(', ')}`;
  }

  return null;
}