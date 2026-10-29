/**
 * 错误分类 - 不同错误用不同处理
 *
 * 原理：不是所有错都一样。配置错、网络错、API 错处理方式不同
 *      类比：医院分内科/外科/急诊 —— 错对了科室才能治
 *
 * 用法（catch 里）：
 *   if (e instanceof APIError && e.status === 401) { 提示用户改 key }
 *   if (e instanceof NetworkError) { 自动重试 }
 *   if (e instanceof ConfigError) { 弹"去设置"按钮 }
 */

export class ConfigError extends Error {
  // 配置错：API key 没填、Provider 没选
  constructor(msg: string) {
    super(msg);
    this.name = 'ConfigError';
  }
}

export class NetworkError extends Error {
  // 网络错：断网、DNS 失败、超时
  constructor(msg: string) {
    super(msg);
    this.name = 'NetworkError';
  }
}

export class APIError extends Error {
  // LLM API 错：4xx/5xx、限流、配额超
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.name = 'APIError';
    this.status = status;
  }
}

export class AuthError extends APIError {
  // 401/403 — API Key 无效或没权限
  // 借鉴 goose-main/crates/goose/src/doctor.rs 的 describe_error 思路
  constructor(msg: string) {
    super(msg, 401);
    this.name = 'AuthError';
  }
}

export class RateLimitError extends APIError {
  // 429 — 请求太快被限流
  retryAfterMs?: number;
  constructor(msg: string, retryAfterMs?: number) {
    super(msg, 429);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class CreditsExhaustedError extends APIError {
  // 402 — 余额用完
  topUpUrl?: string;
  constructor(msg: string, topUpUrl?: string) {
    super(msg, 402);
    this.name = 'CreditsExhaustedError';
    this.topUpUrl = topUpUrl;
  }
}

export class EndpointNotFoundError extends APIError {
  // 404 — 模型名不对
  constructor(msg: string) {
    super(msg, 404);
    this.name = 'EndpointNotFoundError';
  }
}

export class ToolError extends Error {
  // 工具执行错：readFile 找不到文件、shell 命令失败
  constructor(msg: string) {
    super(msg);
    this.name = 'ToolError';
  }
}

/**
 * 把任意 error 转成"友好提示 + 修复按钮"
 *
 * 返回值给前端 Webview 用来显示 toast
 */
export interface ErrorView {
  message: string;   // 给用户看的中文提示
  action?: {         // 快捷按钮（点了能直接修）
    label: string;   // 按钮文字
    command: string; // 点的命令（如 'mini-coder.setApiKey'）
  };
}

export function toUserView(e: any): ErrorView {
  // API Key 无效（401） → 让用户去设置
  if (e instanceof APIError && e.status === 401) {
    return {
      message: '⚠ API Key 无效，请检查配置',
      action: { label: '去设置', command: 'mini-coder.setApiKey' },
    };
  }

  // API 限流（429） → 等会儿再试
  if (e instanceof APIError && e.status === 429) {
    return { message: '⏳ 被限流了（429）—— 请求太快，请等 10 秒再试' };
  }

  // 模型不存在（404）→ 模型名写错了
  //   ⚠️ 之前这里没有任何特判，404 会掉进最后的兜底分支，
  //   用户看到的是「💥 出错了：model not found」——
  //   告诉他"模型名写错了、去设置里改"比丢一句英文原文有用得多。
  if (e instanceof APIError && e.status === 404) {
    return {
      message: '❓ 模型不存在（404）—— 模型名写错了。\n   去设置界面改 mini-coder.model，或用该 Provider 的默认模型。',
      action: { label: '去设置', command: 'mini-coder.setApiKey' },
    };
  }

  // ⭐⭐ API 余额不足（402）—— 这是【账的问题】，不是 key 的问题（2026-10-29 拆开）
  //
  //   MiniMax 返回 402 insufficient_balance_error，DeepSeek 也一样。
  //   之前 402 和 403 被合并成一句「API 配额不足或无权限，请检查账户」——
  //   用户看到这句话的第一反应是"去检查 key"，于是反复重填 key、
  //   反复换 provider，绕了半天才发现：key 一直是好的，【只是没钱了】。
  //
  //   所以 402 必须把"去充值 / 换套餐订阅 Key"直接写进提示里。
  if (e instanceof APIError && e.status === 402) {
    const topUp = (e as any).topUpUrl;
    return {
      message:
        '💰 账户余额不足 —— key 是有效的，但账户没钱了。\n' +
        '   去平台「账户钱包 → 充值」；或改用「套餐详情」里的订阅 Key（走套餐额度，不按量扣费）。' +
        (topUp ? `\n   ${topUp}` : ''),
    };
  }

  // API 无权限（403）—— key 有效，但这个账号/套餐不覆盖你要用的模型
  if (e instanceof APIError && e.status === 403) {
    return {
      message:
        '🚫 账号无权限 —— key 是有效的，但当前套餐不包含这个模型。\n' +
        '   去平台确认套餐覆盖的模型名，或换用「套餐详情」里的订阅 Key。',
    };
  }

  // API 5xx → 服务端炸了
  if (e instanceof APIError && e.status >= 500) {
    return { message: `🔧 LLM 服务异常（${e.status}），请稍后再试` };
  }

  // 配置错 → 引导去设置
  if (e instanceof ConfigError) {
    return {
      message: `⚙ 配置问题：${e.message}`,
      action: { label: '去设置', command: 'mini-coder.setApiKey' },
    };
  }

  // 网络错 → 提示用户
  if (e instanceof NetworkError) {
    return { message: `🌐 网络问题：${e.message}（已自动重试）` };
  }

  // 工具错 → 显示原始错误
  if (e instanceof ToolError) {
    return { message: `🔧 工具执行失败：${e.message}` };
  }

  // 其他 → 原样显示
  return { message: `💥 出错了：${e?.message || String(e)}` };
}
