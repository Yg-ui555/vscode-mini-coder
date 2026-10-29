/**
 * 错误提示文案测试（2026-10-29 加）
 *
 * ⭐ 为什么这层要单独测
 *
 *   `toUserView` 是"服务端发生了什么"翻译成"人该怎么办"的唯一出口。
 *   2026-10-29 用户卡了大半天，根因就是这一层的锅：
 *
 *     · 服务端返回 402（余额不足），扩展日志写的是「余额用完」
 *     · 但 toUserView 把 402 和 403 合并成一句「API 配额不足或无权限，请检查账户」
 *     · 用户看到的第一反应是"我的 key 坏了" → 于是反复重填 key、反复换 provider
 *     · 最后是他自己拿 key 去打接口，才定位到【账上没钱】
 *
 *   也就是说：**翻译层把"充值"翻译成了"检查 key"**，
 *   把用户往错误的方向引了整整一晚。
 *
 *   所以这里的断言不是"文案好不好听"，而是"文案有没有把用户指到正确的下一步"。
 */

import { describe, it, expect } from 'vitest';
import {
  toUserView,
  APIError,
  AuthError,
  RateLimitError,
  CreditsExhaustedError,
  EndpointNotFoundError,
  NetworkError,
  ConfigError,
} from '../errors';

describe('toUserView —— 错误提示必须指对方向', () => {
  it('401 → 说清是 key 的问题，并给"去设置"按钮', () => {
    const v = toUserView(new AuthError('unauthorized'));
    expect(v.message).toContain('API Key 无效');
    expect(v.action?.command).toBe('mini-coder.setApiKey');
  });

  it('⭐ 402 → 必须说【余额】并给出充值指引，不能说"无权限"', () => {
    const v = toUserView(new CreditsExhaustedError('insufficient balance'));

    // 关键词：余额 + 充值
    expect(v.message).toContain('余额');
    expect(v.message).toContain('充值');

    // 关键断言：不能再把"充值"翻译成"检查 key"
    //   —— 401 才是 key 的问题，402 是账的问题，混了就会把人带偏
    expect(v.message).not.toContain('无权限');
    expect(v.message).not.toContain('API Key 无效');
  });

  it('⭐ 403 → 说【无权限】，不能误报成余额不足', () => {
    const v = toUserView(new APIError('forbidden', 403));
    expect(v.message).toContain('无权限');
    expect(v.message).not.toContain('余额');
  });

  it('402 与 403 的提示【不能是同一句】', () => {
    const a = toUserView(new CreditsExhaustedError('x'));
    const b = toUserView(new APIError('x', 403));
    expect(a.message).not.toBe(b.message);
  });

  it('402 带 topUpUrl 时要把它贴进提示里', () => {
    const v = toUserView(
      new CreditsExhaustedError('x', 'https://platform.minimaxi.com/console/recharge'),
    );
    expect(v.message).toContain('platform.minimaxi.com');
  });

  it('429 → 限流', () => {
    const v = toUserView(new RateLimitError('slow down'));
    expect(v.message).toContain('限流');
  });

  it('404 → 模型不存在', () => {
    const v = toUserView(new EndpointNotFoundError('model not found'));
    expect(v.message).toContain('模型');
  });

  it('网络错 → 说网络，不要说成 key 的问题', () => {
    const v = toUserView(new NetworkError('fetch failed'));
    expect(v.message).toContain('网络');
    expect(v.message).not.toContain('API Key');
  });

  it('配置错 → 给"去设置"按钮', () => {
    const v = toUserView(new ConfigError('没填 key'));
    expect(v.action?.command).toBe('mini-coder.setApiKey');
  });
});
