/**
 * 中断续跑（run checkpoint）
 *
 * ─────────────────────────────────────────────────────────────
 * 要解决的痛点
 * ─────────────────────────────────────────────────────────────
 *
 *   现在用户点"停止"之后，AI 就彻底停了。下次想继续，必须把
 *   "我刚才让它干什么、做到哪了"重新解释一遍。
 *
 *   而 AI 编程任务恰恰是那种"上下文很长"的活：
 *   改了 8 个文件、跑了 20 轮测试、其中 3 轮在调同一个 bug ——
 *   让用户重述一遍既啰嗦又容易出错（用户也不知道它到底干了什么）。
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 核心设计原则：绝不让模型"重复执行已有副作用的操作"
 * ─────────────────────────────────────────────────────────────
 *
 *   这是整个功能最容易做错、也最重要的一点。
 *
 *   nanobot 的 recovery.py 里有一句话点破了它：
 *
 *     "silently dropping a malformed tool result could make the model
 *      repeat an external side effect"
 *
 *   翻译成人话：如果某个工具可能已经产生了【外部副作用】
 *   （git push 已经发出去了、文件已经被删了、部署脚本已经跑了），
 *   而我们只是悄悄把它的调用记录删掉，那么模型看到"没这回事"，
 *   下一步很可能【再做一遍】——
 *
 *     问题就从"做了一次" 变成了 "做了两次"，而且用户毫无察觉。
 *
 *   所以正确做法是：
 *     · 已完成的工具 → 结果原样保留，模型看得见"我干过了"
 *     · 未执行的工具 → 显式告诉模型"这一步没执行完"
 *       而不是假装它不存在
 *
 *   这跟 util/historyRepair.ts 是同一条原则（显式告知，而非静默丢弃），
 *   两处必须保持一致，否则会出现"一边补说明一边又静默删掉"的自相矛盾。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么用【旁路文件】而不是写进 JSONL
 * ─────────────────────────────────────────────────────────────
 *
 *   会话历史是 messages，checkpoint 是"运行时进度"，两者生命周期不同：
 *     · messages 是长期记忆，用户可能回看三周前那次会话
 *     · checkpoint 是短期状态，任务一完成就没用了
 *
 *   混在一起会导致：
 *     1. checkpoint 结构频繁变（nanobot 的 IteratingAgentSession 里就有
 *        好几个 _phase 状态要兼容），写进历史后老会话读不出来
 *     2. 每写一次 checkpoint 都要重写整个 JSONL（现在 save() 是全量重写），
 *        而 checkpoint 是每轮工具都要写的，热路径上不该这么重
 *
 *   旁路文件的好处：
 *     · 独立读写，不影响历史格式，历史文件永远稳定可解析
 *     · 任务完成就删掉，磁盘上不留垃圾
 *     · 崩溃恢复简单：读不到就当没有
 *
 *   这个取舍和 nanobot 的 save_runtime_checkpoint 一致
 *   （它也是写独立的 .checkpoint.json 侧文件）。
 * ─────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';

/** 单个工具调用的身份信息 */
export interface ToolCallRef {
  /** provider 分配的 id，用它和 assistant 消息里的 tool_calls 配对 */
  id: string;
  name: string;
}

/**
 * 一次任务运行的进度快照
 *
 * 注意它【不存 messages】—— messages 由 SessionStore 负责，
 * 这里只存"messages 之外的那点运行状态"，避免两份真相打架。
 */
export interface RunCheckpoint {
  _type: 'runCheckpoint';
  /** 归属会话 */
  sessionId: string;
  updatedAt: string;
  /** 跑到第几轮（0-based） */
  iteration: number;
  /** 本轮 LLM 返回的 assistant 消息 id 列表（用于识别是不是同一轮） */
  batchSignature: string;
  /** 已执行完的工具调用（结果在 session 历史里，这里只记身份） */
  done: ToolCallRef[];
  /** 还没执行的工具调用 —— 恢复时要把它们转成显式的"未执行" */
  pending: ToolCallRef[];
}

const CHECKPOINT_SUFFIX = '.checkpoint.json';

/** checkpoint 文件路径 */
export function checkpointPath(sessionsDir: string, sessionId: string): string {
  // 与 session store 相同的防路径穿越处理
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(sessionsDir, `${safe}${CHECKPOINT_SUFFIX}`);
}

/** 原子写：先写 .tmp 再 rename，避免崩溃留半截 JSON */
function atomicWrite(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 清理失败不致命 */
    }
    throw e;
  }
}

/**
 * 保存进度快照
 *
 * ⚠️ 失败必须静默：checkpoint 是"锦上添花"的能力，
 *   存不下就让这次任务照常跑完，不能因此让主循环崩掉。
 */
export function saveCheckpoint(
  sessionsDir: string,
  cp: Omit<RunCheckpoint, '_type' | 'updatedAt'> & { updatedAt?: string },
): void {
  try {
    const payload: RunCheckpoint = {
      _type: 'runCheckpoint',
      updatedAt: new Date().toISOString(),
      sessionId: cp.sessionId,
      iteration: cp.iteration,
      batchSignature: cp.batchSignature,
      done: cp.done,
      pending: cp.pending,
    };
    atomicWrite(checkpointPath(sessionsDir, cp.sessionId), JSON.stringify(payload, null, 2));
  } catch {
    /* 静默降级 */
  }
}

/**
 * 读取进度快照
 *
 * @returns 读不到 / 损坏 / 结构不对都返回 null（当没有处理）
 */
export function loadCheckpoint(
  sessionsDir: string,
  sessionId: string,
): RunCheckpoint | null {
  try {
    const file = checkpointPath(sessionsDir, sessionId);
    if (!fs.existsSync(file)) return null;

    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as RunCheckpoint;

    // 严格校验：结构不对就当没有，比拿半截数据去恢复安全
    if (
      parsed?._type !== 'runCheckpoint' ||
      typeof parsed.sessionId !== 'string' ||
      !Array.isArray(parsed.done) ||
      !Array.isArray(parsed.pending)
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/** 任务完成 / 用户主动放弃 → 删掉快照 */
export function clearCheckpoint(sessionsDir: string, sessionId: string): void {
  try {
    const file = checkpointPath(sessionsDir, sessionId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* 忽略 */
  }
}

/** 是否有未完成的任务（面板据此显示"继续上次任务"） */
export function hasPendingWork(cp: RunCheckpoint | null): boolean {
  return !!cp && cp.pending.length > 0;
}

/**
 * 把进度快照物化成一组"要追加到 messages 里"的消息
 *
 * ⭐ 这是恢复逻辑的核心，行为必须精确：
 *
 *   对 pending 里的每个工具：
 *     · 如果 messages 里【已经有】它的响应 → 说明它其实跑完了
 *       （可能是在写 checkpoint 之后、删除 checkpoint 之前完成的），
 *       什么都不加，保留原样
 *     · 如果【没有】响应 → 补一条明确说明"这个没执行完"的 tool 消息
 *
 *   为什么不能简单地"把 pending 全部补成未执行"：
 *     存在一个真实的竞态窗口 —— 工具跑成功了、结果也 push 进 messages 了，
 *     但还没来得及更新 checkpoint 就崩溃/被杀了。这时候 pending 里的
 *     记录是过时的，硬补会造成"同一个结果出现两次"。
 *     所以必须先看 messages 实际有没有这条响应。
 *
 *   返回的消息里还会带一条 user 消息，说明"上次停在哪、可以继续"，
 *   让模型有明确的续跑起点，而不是自己猜。
 */
export function materializeResume(cp: RunCheckpoint, messages: any[]): any[] {
  const out: any[] = [];

  // 已经拿到响应的 tool_call_id
  const answered = new Set<string>();
  for (const m of messages) {
    if (m?.role === 'tool' && typeof m.tool_call_id === 'string') {
      answered.add(m.tool_call_id);
    }
  }

  const actuallyPending: ToolCallRef[] = [];

  for (const tc of cp.pending) {
    if (answered.has(tc.id)) continue; // 其实跑完了，不重复声明
    actuallyPending.push(tc);
    out.push({
      role: 'tool',
      tool_call_id: tc.id,
      content:
        `[这个工具调用在上次任务中断时没有执行，工具名：${tc.name}。\n` +
        `它【没有产生任何效果】—— 文件没被改、命令没跑。\n` +
        `如果当前任务需要它的结果，请重新调用一次；` +
        `如果它的部分效果其实已经落地了，请先用 read_file / run_shell 核实当前实际状态，再决定怎么做，]` +
        `不要假定它已经成功。]`,
    });
  }

  if (out.length === 0) return [];

  const doneNames = cp.done.map((d) => d.name);
  const uniqueDone = [...new Set(doneNames)];

  out.push({
    role: 'user',
    content:
      `[系统提示：上一次任务在第 ${cp.iteration + 1} 轮被中断了（可能是你点了停止，或编辑器被关闭）。\n` +
      (uniqueDone.length > 0
        ? `已经执行完成的工具：${uniqueDone.join('、')}。\n`
        : '') +
      `没执行完的工具：${actuallyPending.map((t) => t.name).join('、')}。\n\n` +
      `接下来请：\n` +
      `1. 先核实当前文件的实际状态（用 read_file / list_dir），确认中断前到底改到了哪里\n` +
      `2. 告诉用户"上次停在这里，接下来要我做什么"\n` +
      `3. 用户确认后继续，不要从头再来，也不要重复执行已经完成的操作]`,
  });

  return out;
}

/** 给面板显示的一行摘要 */
export function describeCheckpoint(cp: RunCheckpoint): string {
  const doneCount = cp.done.length;
  const pendingNames = [...new Set(cp.pending.map((p) => p.name))];
  const when = new Date(cp.updatedAt).toLocaleString('zh-CN');

  return (
    `上次任务在第 ${cp.iteration + 1} 轮中断（${when}）\n` +
    `已完成 ${doneCount} 个工具调用` +
    (pendingNames.length > 0 ? `，未完成：${pendingNames.join('、')}` : '')
  );
}

/** 批次签名：用来判断 checkpoint 是不是属于当前这一轮 LLM 返回的那批工具 */
export function makeBatchSignature(toolCalls: Array<{ id: string }>): string {
  return toolCalls.map((t) => t.id).join(',');
}