/**
 * Provider 熔断与降级的单元测试（2026-10-24）
 *
 * 为什么这些必须测：
 *   降级逻辑是【故障时才执行】的路径 ——
 *   平时跑得好好的，一旦出事就靠它兜底。
 *   这种「平时不跑、出事才跑」的代码，没有测试就是定时炸弹。
 */

import { describe, it, expect } from 'vitest';
import {
  shouldFallback,
  CircuitBreaker,
  FallbackChain,
  DEFAULT_BREAKER_CONFIG,
} from '../agent/providerFallback';
import {
  APIError,
  AuthError,
  CreditsExhaustedError,
  EndpointNotFoundError,
  RateLimitError,
  NetworkError,
  ConfigError,
} from '../errors';

describe('⭐ shouldFallback —— 换一家 provider 有意义吗', () => {
  it('鉴权失败 → 降级（用户的另一把 key 是好的）', () => {
    expect(shouldFallback(new AuthError('401'))).toBe(true);
  });

  it('⭐ 余额用完 → 降级（最常见的场景）', () => {
    expect(shouldFallback(new CreditsExhaustedError('402'))).toBe(true);
  });

  it('限流 → 降级', () => {
    expect(shouldFallback(new RateLimitError('429'))).toBe(true);
  });

  it('网络错误 → 降级', () => {
    expect(shouldFallback(new NetworkError('断网'))).toBe(true);
  });

  it('服务端 5xx → 降级', () => {
    expect(shouldFallback(new APIError('500', 500))).toBe(true);
  });

  it('⭐⭐ 请求格式错 400 → 【不降级】（换谁都一样错）', () => {
    expect(shouldFallback(new APIError('400', 400))).toBe(false);
  });

  it('⭐ 模型不存在 404 → 不降级', () => {
    expect(shouldFallback(new EndpointNotFoundError('404'))).toBe(false);
  });

  it('参数不合法 422 → 不降级', () => {
    expect(shouldFallback(new APIError('422', 422))).toBe(false);
  });

  it('⭐ 用户主动 abort → 绝不降级（用户已经不想等了）', () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    expect(shouldFallback(abortErr)).toBe(false);
  });

  it('未知错误 → 不降级（可能是我们自己的 bug，别掩盖）', () => {
    expect(shouldFallback(new Error('未知错误'))).toBe(false);
    expect(shouldFallback(new ConfigError('配置错'))).toBe(false);
  });
});

describe('⭐ CircuitBreaker —— 熔断器状态机', () => {
  it('初始状态是闭合（正常可用）', () => {
    const b = new CircuitBreaker();
    expect(b.currentState).toBe('closed');
    expect(b.isAvailable()).toBe(true);
  });

  it('⭐ 连续失败达阈值 → 熔断（跳过这个 provider）', () => {
    const b = new CircuitBreaker({ threshold: 3, cooldownMs: 60_000 });
    b.recordFailure();
    b.recordFailure();
    expect(b.isAvailable()).toBe(true); // 还差一次
    b.recordFailure();
    expect(b.currentState).toBe('open');
    expect(b.isAvailable()).toBe(false);
  });

  it('⭐ 成功一次 → 重置计数（不让偶发错误累积）', () => {
    const b = new CircuitBreaker({ threshold: 3, cooldownMs: 60_000 });
    b.recordFailure();
    b.recordFailure();
    b.recordSuccess();
    expect(b.failures).toBe(0);
    expect(b.currentState).toBe('closed');
  });

  it('⭐ 冷却期满 → 进入半开，允许试探一次', () => {
    const b = new CircuitBreaker({ threshold: 1, cooldownMs: 10 });
    b.recordFailure();
    expect(b.isAvailable()).toBe(false);
    // 用 fake timer 不方便，这里直接等一下（10ms 很短）
    const start = Date.now();
    while (Date.now() - start < 20) { /* 忙等 20ms */ }
    expect(b.isAvailable()).toBe(true);
    expect(b.currentState).toBe('halfOpen');
  });

  it('半开状态下再失败 → 回到熔断并重新计时', () => {
    const b = new CircuitBreaker({ threshold: 1, cooldownMs: 10 });
    b.recordFailure();
    const start = Date.now();
    while (Date.now() - start < 20) { /* 等冷却 */ }
    expect(b.isAvailable()).toBe(true);
    b.recordFailure();
    expect(b.currentState).toBe('open');
  });

  it('剩余冷却时间在熔断态可读', () => {
    const b = new CircuitBreaker({ threshold: 1, cooldownMs: 60_000 });
    b.recordFailure();
    expect(b.remainingCooldownMs).toBeGreaterThan(0);
    expect(b.remainingCooldownMs).toBeLessThanOrEqual(60_000);
  });

  it('reset 手动重置（用户换 key 后）', () => {
    const b = new CircuitBreaker({ threshold: 1, cooldownMs: 60_000 });
    b.recordFailure();
    expect(b.isAvailable()).toBe(false);
    b.reset();
    expect(b.currentState).toBe('closed');
    expect(b.isAvailable()).toBe(true);
  });

  it('默认配置是 3 次失败 / 60s 冷却（与 nanobot 一致）', () => {
    expect(DEFAULT_BREAKER_CONFIG.threshold).toBe(3);
    expect(DEFAULT_BREAKER_CONFIG.cooldownMs).toBe(60_000);
  });
});

describe('⭐ FallbackChain —— 降级链', () => {
  const entry = (name: string) => ({ name, create: () => ({ name }) });

  it('⭐ 第一个 provider 成功 → 不再尝试后面的', async () => {
    const chain = new FallbackChain([entry('a'), entry('b')]);
    let called = 0;
    const result = await chain.execute(async (p) => {
      called++;
      return `ok:${p.name}`;
    });
    expect(result).toBe('ok:a');
    expect(called).toBe(1);
  });

  it('⭐ 第一个失败（可降级）→ 自动切到第二个', async () => {
    const chain = new FallbackChain([entry('a'), entry('b')]);
    const result = await chain.execute(async (p) => {
      if (p.name === 'a') throw new CreditsExhaustedError('402');
      return `ok:${p.name}`;
    });
    expect(result).toBe('ok:b');
  });

  it('⭐ 失败（不可降级）→ 直接抛，不浪费时间试第二个', async () => {
    const chain = new FallbackChain([entry('a'), entry('b')]);
    let called = 0;
    await expect(
      chain.execute(async () => {
        called++;
        throw new APIError('400', 400);
      }),
    ).rejects.toThrow();
    expect(called).toBe(1); // ← 关键：只试了一次
  });

  it('⭐ 全部失败 → 抛最后一个错误', async () => {
    const chain = new FallbackChain([entry('a'), entry('b')]);
    await expect(
      chain.execute(async (p) => {
        throw new CreditsExhaustedError(`402:${p.name}`);
      }),
    ).rejects.toThrow('402:b');
  });

  it('⭐ 熔断中的 provider 被跳过', async () => {
    const chain = new FallbackChain([entry('a'), entry('b')]);

    // ⭐ 只把 a 打熔断 —— b 必须成功，否则 b 也会被记失败
    //   （降级链会依次尝试所有 provider，b 成功就不会被记失败）
    for (let i = 0; i < 3; i++) {
      await chain.execute(async (p) => {
        if (p.name === 'a') throw new CreditsExhaustedError('402');
        return 'ok';
      });
    }
    const states = chain.getStates();
    expect(states[0].state).toBe('open');
    expect(states[1].state).toBe('closed'); // b 一直是好的

    // 再执行时 a 应该被跳过（只试 b）
    const attempted: string[] = [];
    await chain.execute(
      async (p) => {
        attempted.push(p.name);
        return 'ok';
      },
      (a) => attempted.push(`attempt:${a.providerName}`),
    );

    // a 不该被真正调用过
    expect(attempted).not.toContain('a');
    // b 被调用了
    expect(attempted).toContain('b');
  });

  it('⭐ 熔断跳过的 provider 会走 skipped 回调（UI 可展示原因）', async () => {
    const chain = new FallbackChain([entry('a'), entry('b')]);
    for (let i = 0; i < 3; i++) {
      await chain.execute(async (p) => {
        if (p.name === 'a') throw new CreditsExhaustedError('402');
        return 'ok';
      });
    }

    const attempts: any[] = [];
    await chain.execute(async () => 'ok', (a) => attempts.push(a));

    const skipped = attempts.find((a) => a.providerName === 'a');
    expect(skipped).toBeDefined();
    expect(skipped.skipped).toContain('熔断');
  });

  it('⭐ 每次尝试都有回调（用于记日志 / 更新 UI）', async () => {
    const chain = new FallbackChain([entry('a'), entry('b')]);
    const attempts: any[] = [];
    await chain.execute(
      async (p) => {
        if (p.name === 'a') throw new CreditsExhaustedError('402');
        return 'ok';
      },
      (a) => attempts.push(a),
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[0].ok).toBe(false);
    expect(attempts[1].ok).toBe(true);
  });

  it('成功会重置熔断计数', async () => {
    const chain = new FallbackChain([entry('a')]);
    await chain.execute(async () => { throw new CreditsExhaustedError('402'); }).catch(() => {});
    await chain.execute(async () => { throw new CreditsExhaustedError('402'); }).catch(() => {});
    expect(chain.getStates()[0].failures).toBe(2);
    await chain.execute(async () => 'ok');
    expect(chain.getStates()[0].failures).toBe(0);
  });

  it('空链 → 抛明确错误', async () => {
    const chain = new FallbackChain([]);
    await expect(chain.execute(async () => 'x')).rejects.toThrow('没有任何 provider');
  });
});
