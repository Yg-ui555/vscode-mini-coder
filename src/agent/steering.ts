/**
 * 插话队列 —— 用户中途给 agent 补充指令
 *
 * ─────────────────────────────────────────────────────────────
 * 这个机制解决什么
 *
 *   agent 正在改 5 个文件，用户突然说"等等，第 3 个文件先别动"。
 *
 *   没有插话机制时，用户只能点"停止"重来 —— 前面做的活全白费。
 *   有插话机制时，这句话会【排队】，在当前工具批次跑完后注入下一轮。
 *
 *   比喻：秘书正在写稿，老板说"这句改一下"——
 *   秘书不会推倒重写，而是记下来，在下一个自然停顿的地方改。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么用【队列】而不是直接往 messages 里塞
 *
 *   1. agent 正在执行工具时，messages 里的结构必须保持 OpenAI 协议合法
 *      （assistant 声明了 N 个 tool_call 就必须紧跟 N 条 tool 消息）。
 *      中途插一条 user 消息进去会破坏这个结构 → provider 报 400。
 *   2. 用户可能在 agent 跑的时候连着说三句，顺序要保留。
 *   3. 插话应该在【工具批次之间】生效，而不是打断一个正在跑的写操作
 *      —— 打断会留下半执行状态。
 *
 * ─────────────────────────────────────────────────────────────
 * 借鉴 goose 的 ops_steer.rs:60-97
 *   它也只在"两轮之间"且"没有待答工具请求"时生效。
 */

/**
 * 插话队列
 *
 * ⚠️ `pending` 故意是 public 的 —— 主循环要拿【同一个数组引用】，
 *    这样它 drain 的时候清的就是面板 push 进来的那个数组。
 *    用 getter 返回副本的话，两边就不是一个东西了。
 */
export class SteeringQueue {
  readonly pending: string[] = [];

  /** 用户插了一句 */
  push(message: string): void {
    const text = (message ?? '').trim();
    if (!text) return;
    this.pending.push(text);
  }

  /** 取走全部并清空 */
  drain(): string[] {
    if (this.pending.length === 0) return [];
    return this.pending.splice(0, this.pending.length);
  }

  get size(): number {
    return this.pending.length;
  }

  clear(): void {
    this.pending.length = 0;
  }
}

/** 全局单例（跟 repeatGuard / hook manager 同一套模式） */
const queue = new SteeringQueue();

export function getSteeringQueue(): SteeringQueue {
  return queue;
}
