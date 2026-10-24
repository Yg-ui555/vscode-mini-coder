/**
 * Provider 熔断与降级（2026-10-24）
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么这是 BYOK 产品的【生死线】
 * ─────────────────────────────────────────────────────────────
 *
 *   本项目是 BYOK（Bring Your Own Key）模式 —— 用户自带 API Key。
 *   这意味着用户会遇到这些事，而且【一定会遇到】：
 *
 *     · Key 过期 / 被撤销        → 401
 *     · 账户余额用完             → 402  ← 最常见！DeepSeek 用量大的用户天天遇到
 *     · 某家 API 临时抽风        → 500 / 503
 *     · 被限流                    → 429
 *
 *   没有降级时的行为：直接抛错 → agent 罢工 → 用户骂人 → 卸载。
 *
 *   有降级时的行为：
 *     「DeepSeek 余额用完了，已自动切到 MiniMax 继续。」
 *     → 用户根本没感觉，任务继续完成。
 *
 *   类比：
 *     你去一家银行取钱，发现这家今天停业。
 *     差的做法：站在门口骂，然后回家。
 *     好的做法：知道隔壁分行还开着，自动走过去。
 *
 * ─────────────────────────────────────────────────────────────
 * 借鉴来源：nanobot 的 providers/fallback_provider.py
 * ─────────────────────────────────────────────────────────────
 *
 *   · 错误分类（fallback_provider.py:716-759）：
 *       不是所有错误都该降级 —— 换一家也一样错的话，浪费时间
 *   · 熔断器（fallback_provider.py:521-527）：
 *       连续 N 次失败 → 熔断一段时间 → 期间直接跳过这个 provider
 *   · 流式安全（fallback_provider.py:494-511）：
 *       已经吐了一半内容才失败时，只有 timeout 才敢降级
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 本项目的优势：错误分类已经做好了
 * ─────────────────────────────────────────────────────────────
 *
 *   src/errors.ts 里已经有完整的错误分类：
 *     AuthError(401) / RateLimitError(429) / CreditsExhaustedError(402)
 *     / EndpointNotFoundError(404) / APIError / NetworkError
 *
 *   所以这个模块【不需要重新造错误类型】，只需要回答一个问题：
 *     「这个错误，换一家 provider 有意义吗？」
 */

import {
  APIError,
  AuthError,
  CreditsExhaustedError,
  EndpointNotFoundError,
  RateLimitError,
  NetworkError,
} from '../errors';

/**
 * 判断这个错误【该不该降级】到另一个 provider
 *
 * 决策表：
 *
 * | 错误 | 降级？ | 理由 |
 * |---|---|---|
 * | 401 鉴权失败 | ✅ | 换家还能用（用户的另一把 key 是好的） |
 * | 402 余额用完 | ✅ | 换家还能用 ← 最常见的场景 |
 * | 403 无权限 | ✅ | 同上 |
 * | 429 限流 | ✅ | 临时问题，换家能绕开 |
 * | 5xx 服务端故障 | ✅ | 临时问题 |
 * | 网络错误 | ✅ | 可能是这家线路问题 |
 * | 400 请求格式错 | ❌ | 请求本身有问题，换谁都一样错 |
 * | 404 模型不存在 | ❌ | 这个 provider 没这个模型，换家有 |
 * | 422 参数不合法 | ❌ | 同 400 |
 * | 用户主动 abort | ❌ | 用户不想等了，换家更烦 |
 *
 * ⚠️ 400/404/422 不降级是【最重要】的一条：
 *   降级意味着重新发一次完整请求（花钱 + 时间）。
 *   如果错误跟 provider 无关，降级就是纯浪费。
 */
export function shouldFallback(err: unknown): boolean {
  // 用户主动中断 —— 绝不能降级（用户已经不想等了）
  if (err && typeof err === 'object' && (err as any).name === 'AbortError') {
    return false;
  }

  // 网络错误 —— 降级（可能是这家线路的问题）
  if (err instanceof NetworkError) return true;

  // 鉴权失败 —— 降级
  if (err instanceof AuthError) return true;

  // 余额用完 —— 降级（最常见场景）
  if (err instanceof CreditsExhaustedError) return true;

  // 限流 —— 降级
  if (err instanceof RateLimitError) return true;

  if (err instanceof APIError) {
    // 请求本身有问题 —— 【不降级】
    if (err.status === 400 || err.status === 404 || err.status === 422) {
      return false;
    }
    // 模型不存在 —— 不降级
    if (err instanceof EndpointNotFoundError) return false;
    // 其余（5xx 等）—— 降级
    return err.status >= 500 || err.status === 403;
  }

  // 未知错误 —— 保守起见不降级
  //   理由：未知错误可能是我们自己的代码 bug，换家也白搭，
  //   而且降级会掩盖真正的 bug。
  return false;
}

/**
 * 熔断器（Circuit Breaker）
 *
 * 为什么要熔断，而不每次都试：
 *   如果某个 provider 持续挂（比如欠费后 key 被禁用），
 *   每次请求都先试它 = 每次都白等一次超时 + 白花一次钱。
 *
 *   熔断后直接跳过它，把时间花在能用的 provider 上。
 *
 * 状态机（三态）：
 *
 *   CLOSED（闭合，正常）──连续失败达阈值──▶ OPEN（断开，跳过）
 *        ▲                                      │
 *        │                                  冷却期满
 *        │                                      ▼
 *        └───── 成功一次 ─────── HALF_OPEN（半开，试探一次）
 *
 *   类比：保险丝。
 *     电流过大 → 保险丝熔断，电路断开（不用再试了）
 *     冷却一会儿 → 换新保险丝（试探一次）
 *     试探成功 → 恢复正常
 *
 * 借鉴 nanobot 的 fallback_provider.py:521-527（3 次失败 / 60s 冷却）
 */
export type CircuitState = 'closed' | 'open' | 'halfOpen';

export interface CircuitBreakerConfig {
  /** 连续失败多少次后熔断 */
  threshold: number;
  /** 熔断后冷却多久（毫秒） */
  cooldownMs: number;
}

export const DEFAULT_BREAKER_CONFIG: CircuitBreakerConfig = {
  threshold: 3,
  cooldownMs: 60_000,
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private config: CircuitBreakerConfig = DEFAULT_BREAKER_CONFIG) {}

  /** 当前状态（供 UI / 日志显示） */
  get currentState(): CircuitState {
    return this.state;
  }

  /** 连续失败次数 */
  get failures(): number {
    return this.consecutiveFailures;
  }

  /** 剩余冷却时间（毫秒），不在熔断态返回 0 */
  get remainingCooldownMs(): number {
    if (this.state !== 'open') return 0;
    // ⚠️ 必须用 this.config.cooldownMs，不能用 this.cooldownMs
    //   （后者不存在 → undefined → 运算得 NaN → 这里会返回 0，
    //     表现为「熔断了但显示没有冷却时间」）
    const remaining = this.config.cooldownMs - (Date.now() - this.openedAt);
    return remaining > 0 ? remaining : 0;
  }

  /**
   * 这个 provider 现在能不能用
   *
   * @returns true = 可以尝试；false = 已熔断，跳过
   */
  isAvailable(): boolean {
    if (this.state === 'closed') return true;

    if (this.state === 'open') {
      // 冷却期满 → 进入半开状态，允许试探一次
      if (Date.now() - this.openedAt >= this.config.cooldownMs) {
        this.state = 'halfOpen';
        return true;
      }
      return false;
    }

    // halfOpen：只允许一次试探
    return true;
  }

  /** 记录一次成功 */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'closed';
  }

  /** 记录一次失败 */
  recordFailure(): void {
    this.consecutiveFailures++;

    if (this.state === 'halfOpen') {
      // 半开状态下试探失败 → 直接回到熔断，重新计时
      this.state = 'open';
      this.openedAt = Date.now();
      return;
    }

    if (this.consecutiveFailures >= this.config.threshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }

  /** 手动重置（比如用户换了新 key） */
  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
  }
}

/**
 * 降级链 —— 管理多个 provider 的优先级与熔断状态
 *
 * 用法：
 *   const chain = new FallbackChain([
 *     { name: 'deepseek', create: () => new OpenAIProvider(...) },
 *     { name: 'minimax',  create: () => new OpenAIProvider(...) },
 *   ]);
 *   const result = await chain.execute((provider) => provider.stream(...));
 */
export interface ProviderEntry<T> {
  /** provider 标识（用于日志与 UI 展示） */
  name: string;
  /** 构造 provider 实例的工厂（降级时才创建，省内存） */
  create: () => T;
}

export interface FallbackAttempt {
  providerName: string;
  ok: boolean;
  error?: unknown;
  /** 跳过的原因（熔断中） */
  skipped?: string;
}

export class FallbackChain<T> {
  private breakers = new Map<string, CircuitBreaker>();

  constructor(private entries: ProviderEntry<T>[]) {
    for (const e of entries) {
      this.breakers.set(e.name, new CircuitBreaker());
    }
  }

  /** 各 provider 的熔断状态（供 /doctor 和 UI 展示） */
  getStates(): Array<{ name: string; state: CircuitState; failures: number; remainingMs: number }> {
    return this.entries.map((e) => {
      const b = this.breakers.get(e.name)!;
      return {
        name: e.name,
        state: b.currentState,
        failures: b.failures,
        remainingMs: b.remainingCooldownMs,
      };
    });
  }

  /** 重置所有熔断器（用户换 key 后调用） */
  resetAll(): void {
    for (const b of this.breakers.values()) b.reset();
  }

  /**
   * 依次尝试各个 provider，直到有一个成功
   *
   * @param operation 对单个 provider 的操作（可能是流式的）
   * @param onAttempt 每���尝试后的回调（用于记日志 / 更新 UI）
   */
  async execute(
    operation: (provider: T, providerName: string) => Promise<any>,
    onAttempt?: (attempt: FallbackAttempt) => void,
  ): Promise<any> {
    if (this.entries.length === 0) {
      throw new Error('降级链里没有任何 provider');
    }

    let lastError: unknown;

    for (const entry of this.entries) {
      const breaker = this.breakers.get(entry.name)!;

      // 熔断中 → 跳过
      if (!breaker.isAvailable()) {
        const remaining = Math.ceil(breaker.remainingCooldownMs / 1000);
        const attempt: FallbackAttempt = {
          providerName: entry.name,
          ok: false,
          skipped: `已熔断，${remaining}s 后重试`,
        };
        onAttempt?.(attempt);
        continue;
      }

      try {
        const result = await operation(entry.create(), entry.name);
        breaker.recordSuccess();
        onAttempt?.({ providerName: entry.name, ok: true });
        return result;
      } catch (err) {
        lastError = err;
        breaker.recordFailure();

        // 这个错误不该降级 → 直接抛出去，别浪费时间
        if (!shouldFallback(err)) {
          onAttempt?.({ providerName: entry.name, ok: false, error: err });
          throw err;
        }

        onAttempt?.({ providerName: entry.name, ok: false, error: err });
      }
    }

    // 所有 provider 都试过了
    throw lastError ?? new Error('所有 provider 都不可用');
  }
}
