/**
 * 重复调用检测（Repeat Guard）
 *
 * ─────────────────────────────────────────────────────────────
 * 要解决的痛点（来自 eval/RESULTS.md 的真实数据）
 * ─────────────────────────────────────────────────────────────
 *
 *   评测报告里写着：
 *     「疑似死循环（单工具调用 ≥5 次）（7）」
 *     18 道题里有 7 道出现同一工具重复调用 ≥5 次，
 *     其中 13-hard-perf-optimize 打转 10 次、单题烧掉 ¥0.3575。
 *
 *   总成本 108 万 token 里，输入占 102 万 —— 输入是输出的 20 倍。
 *   根源就是 ReAct 循环每轮重发全量上下文，
 *   而「同一个文件读了 8 遍」这种重复内容会被重发 8 次。
 *
 *   类比：
 *     你让实习生去仓库拿三样东西。
 *     他跑了两趟，第一趟忘了拿扳手，第二趟忘了拿手套……
 *     每次都付一趟路费。
 *
 *     好的做法：给他一张清单，拿完打勾。清单上有的，不用再跑。
 *     但如果清单上的东西【已经被人动过了】，那就得重新核实一次 ——
 *     不过要告诉他「上次你拿过，但现在位置可能变了」。
 *
 * ─────────────────────────────────────────────────────────────
 * 借鉴来源：nanobot 的两层设计
 * ─────────────────────────────────────────────────────────────
 *
 *   第一层（文件读取去重）：
 *     nanobot/agent/tools/file_state.py:80-97  is_unchanged()
 *     四重校验：参数一致 + 磁盘内容 hash 未变 + 结果 hash 一致
 *               + 【原结果仍存在于当前模型上下文里】
 *
 *   第二层（重复外部查询节流）：
 *     nanobot/utils/runtime.py:93-131
 *     按签名计数，第 3 次直接拦截并给出"换个说法"的提示。
 *
 *   ⭐ 为什么第四重校验（原结果是否还在上下文里）是精髓：
 *     上下文压缩会把旧结果移出上下文。
 *     此时如果还返回 stub（"文件没变"），模型就永远看不到那个文件的内容了
 *     —— 信息丢失，比多读一次严重得多。
 *     所以必须先确认「模型现在还看不看得见那份结果」，
 *     看得见才敢省，看不见就必须老老实实再读一次。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 最关键的设计决策：拦截时【不能硬拒绝】
 * ─────────────────────────────────────────────────────────────
 *
 *   ✅ 正确：返回信息性提示（isError 不设）
 *      [File unchanged since last read: src/parser.js]
 *      （模型看到这句，知道自己已经读过，直接用之前的结果）
 *
 *   ❌ 错误：返回 error
 *      [错误] 该文件已读取过
 *      （模型会以为工具坏了 → 换个方式再读一遍 → 更糟）
 *
 *   这跟 registry.ts:60-68 的 _RETRY_HINT 是同一个思路：
 *     工具"失败"时 LLM 倾向于原样重试或换工具硬来；
 *     工具"成功但没给新信息"时 LLM 才会停下来思考。
 */

import * as crypto from 'crypto';

/** 内容 hash（用 sha1，够用且快；不是安全场景） */
export function hashContent(content: string): string {
  return crypto.createHash('sha1').update(content ?? '').digest('hex');
}

/**
 * 一次读取的「回执」
 *
 * 记录这次读了什么、当时文件长什么样、结果是什么。
 */
export interface ReadReceipt {
  /** 归一化后的路径（作为 map 的 key） */
  path: string;
  /** 读取参数 */
  offset?: number;
  limit?: number;
  /** 当时磁盘内容的内容 hash */
  contentHash: string;
  /** 当时工具返回结果的内容 hash */
  resultHash: string;
  /** 这次调用在 messages 里的 tool_call_id（用来查"结果是否还在上下文里"） */
  callId?: string;
}

/** 判定"同一个调用"的签名 */
function readSignature(path: string, offset?: number, limit?: number): string {
  return `${path}|${offset ?? ''}|${limit ?? ''}`;
}

/** 判定"同一个外部查询"的签名 */
function querySignature(kind: string, param: string): string {
  return `${kind}|${param}`;
}

/**
 * 同一签名的重复次数达到这个值才拦截
 *
 * ⚠️ 计数语义（很重要，容易搞错）：
 *
 *   调用顺序是「先 check 再 record」，所以：
 *     第 1 次调用：check 时 count=0 → 放行 → record → count=1
 *     第 2 次调用：check 时 count=1 → 放行 → record → count=2
 *     第 3 次调用：check 时 count=2 → 【拦截】
 *
 *   也就是说 threshold=2 对应「第 3 次调用被拦截」。
 *   这个语义与 nanobot/utils/runtime.py:13 的阈值 2 一致
 *   （nanobot 的注释写的是"第 3 次直接拦截"）。
 */
const QUERY_STRIKE_THRESHOLD = 2;

/**
 * 重复调用守卫
 *
 * 生命周期：跟 AgentLoop 一次 run 绑定。
 * 为什么不放在全局？
 *   因为「结果是否还在上下文里」是跟具体这次会话的 messages 绑定的。
 *   换个会话，模型看到的东西就不同了，判定必须重算。
 */
export class RepeatGuard {
  /** 文件读取回执：signature → receipt */
  private reads = new Map<string, ReadReceipt>();

  /** 外部查询计数：signature → 次数 */
  private queries = new Map<string, number>();

  /**
   * 判断这次读取是否可以省掉
   *
   * @param path       归一化后的绝对路径
   * @param offset     读取偏移
   * @param limit      读取行数限制
   * @param currentHash 现在磁盘内容的 hash（调用方读文件后算）
   * @param isResultStillVisible 关键：这个参数传 false 时【一定不省】
   *        —— 表示模型上下文里已经没有上次的结果了（比如刚被压缩掉）
   * @returns null = 正常执行；非 null = 应该返回给模型的提示文本
   */
  checkRead(
    path: string,
    offset: number | undefined,
    limit: number | undefined,
    currentHash: string,
    isResultStillVisible: boolean,
  ): string | null {
    // 上下文里已经看不到上次的结了 → 绝不能省
    if (!isResultStillVisible) return null;

    const sig = readSignature(path, offset, limit);
    const prev = this.reads.get(sig);
    if (!prev) return null;

    // 参数一致（sig 已保证）+ 磁盘内容没变
    if (prev.contentHash !== currentHash) return null;

    return (
      `[File unchanged since last read: ${path}]\n` +
      `你刚才已经读过这个文件，内容没有变化（offset=${offset ?? '默认'} limit=${limit ?? '默认'}）。\n` +
      `请直接使用之前读到的内容，不要重复读取。\n` +
      `（如果你需要重新确认，请先修改文件或用其他方式核实当前状态。）`
    );
  }

  /**
   * 记录一次读取（在工具执行完成后调用）
   */
  recordRead(
    path: string,
    offset: number | undefined,
    limit: number | undefined,
    contentHash: string,
    resultHash: string,
    callId?: string,
  ): void {
    this.reads.set(readSignature(path, offset, limit), {
      path,
      offset,
      limit,
      contentHash,
      resultHash,
      callId,
    });
  }

  /**
   * 判断这次外部查询是否重复过多
   *
   * @param kind  查询类型（web_fetch / web_search / run_shell 等）
   * @param param 查询签名参数（URL / query / command）
   * @returns null = 正常执行；非 null = 应该返回给模型的提示文本
   */
  checkQuery(kind: string, param: string): string | null {
    const sig = querySignature(kind, param);
    const count = this.queries.get(sig) ?? 0;
    if (count < QUERY_STRIKE_THRESHOLD) return null;

    return (
      `[重复查询已拦截] 你已经用同样的方式查询过 ${count} 次「${param}」。\n` +
      `请不要再重复同一个查询。\n` +
      `请使用你已经拿到的结果来回答，或者换一个【有实质区别】的信息源 / 参数。\n` +
      `（如果确实需要重试，请先说明前几次的结果为什么不够用。）`
    );
  }

  /** 记录一次外部查询 */
  recordQuery(kind: string, param: string): void {
    const sig = querySignature(kind, param);
    this.queries.set(sig, (this.queries.get(sig) ?? 0) + 1);
  }

  /**
   * ⭐ 工作区被修改后，让「外部查询」的计数全部失效
   *
   * 为什么必须失效：
   *   grep 的结果取决于【整个工作区的状态】。
   *   如果 agent 改了文件之后再 grep 同样的 pattern，结果是【不同的】 ——
   *   此时拦截它就是错的，会逼 agent 用过期的搜索结果做决策。
   *
   *   类比：
   *     你让实习生查"仓库里哪些文件提到 X"，他查完了。
   *     你说"把 A 文件改成 Y"，他改完了。
   *     你又问"哪些文件提到 X" —— 这次答案可能不一样了（多了一处）。
   *     这时候拿第一次的结果糊弄他，是错的。
   *
   *   借鉴来源：nanobot/agent/tools/file_state.py:76-78
   *     （写入即失效 read receipt —— 同一个思路）
   *
   * ⚠️ 只清外部查询计数，【不清】读取回执：
   *     读取回执是【按内容 hash】判定的 ——
   *     文件真变了，hash 自然不同，不会被误拦。
   *     而没变的文件仍然可以放心复用结果。
   */
  invalidateQueryCounts(): void {
    this.queries.clear();
  }

  /** 当前已记录的读取回执数量（供 /doctor 和测试用） */
  get readCount(): number {
    return this.reads.size;
  }

  /** 当前已记录的查询计数数量（供 /doctor 和测试用） */
  get queryCount(): number {
    return this.queries.size;
  }

  /** 清空所有记录（换会话时调用） */
  reset(): void {
    this.reads.clear();
    this.queries.clear();
  }
}

/**
 * 全局单例
 *
 * 为什么是全局而不是注入：
 *   工具实例是 registry 里长期存在的（factory.ts 每次 createDefaultRegistry
 *   才新建），而 AgentLoop 也是长生命周期的。
 *   用全局单例 + 在 run 开始时 reset，语义上等价于「每次任务独立计数」，
 *   但避免了把 guard 一路透传到 9 个工具构造函数里的改动量。
 */
let currentGuard: RepeatGuard | null = null;

/** 取当前守卫（没有就临时建一个） */
export function getGuard(): RepeatGuard {
  if (!currentGuard) currentGuard = new RepeatGuard();
  return currentGuard;
}

/** 新任务开始时重置计数 */
export function resetGuard(): void {
  if (currentGuard) currentGuard.reset();
}

/**
 * ⭐ 当前上下文里「还看得见」的 tool_call_id 集合
 *
 * 为什么需要它：
 *   重复检测的第四重校验是「原结果是否还在模型上下文里」。
 *   上下文压缩会把旧结果移出上下文 —— 此时如果还返回
 *   「文件没变」的 stub，模型就永远看不到那个文件内容了。
 *
 *   所以 loop 必须把「现在哪些 tool_call_id 还看得见」告诉守卫。
 *
 *   谁维护它：
 *     loop 在每轮开始时，根据 messages 重算一遍。
 *     压缩发生时（maybeCompact）也会重算 —— 这正是关键：
 *     被压缩掉的结果不在 messages 里了 → 自然就"看不见了"。
 */
let visibleCallIds = new Set<string>();

/**
 * 更新「当前可见的 tool_call_id 集合」
 *
 * @param ids 由 loop 从 messages 里扫出来的 tool_call_id
 */
export function setVisibleCallIds(ids: Set<string>): void {
  visibleCallIds = ids;
}

/** 取当前可见集合（给工具层用） */
export function getVisibleCallIds(): Set<string> {
  return visibleCallIds;
}

/**
 * 检查「某个 tool_call_id 的结果是否还在当前上下文里」
 *
 * 这是四重校验的第四重。工具层自己不知道上下文状态，
 * 必须由 loop 通过 setVisibleCallIds() 告诉它。
 *
 * @param callId 要检查的 id
 */
export function isResultVisible(callId?: string): boolean {
  if (!callId) return false;
  return visibleCallIds.has(callId);
}

/**
 * 便捷版：直接问守卫「这次读取能不能省」
 *
 * 工具层（read_file / grep）用这个，不需要关心细节。
 *
 * @param path        归一化后的绝对路径
 * @param offset      读取偏移
 * @param limit       读取行数限制
 * @param currentHash 现在磁盘内容的 hash
 */
export function checkRepeatRead(
  path: string,
  offset: number | undefined,
  limit: number | undefined,
  currentHash: string,
): string | null {
  return getGuard().checkRead(path, offset, limit, currentHash, true);
}

/** 记录一次读取 */
export function recordRepeatRead(
  path: string,
  offset: number | undefined,
  limit: number | undefined,
  contentHash: string,
  resultHash: string,
  callId?: string,
): void {
  getGuard().recordRead(path, offset, limit, contentHash, resultHash, callId);
}

