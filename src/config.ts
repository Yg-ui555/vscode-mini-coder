/**
 * BYOK 配置管理
 *
 * BYOK = Bring Your Own Key（用户自带 API Key）
 * 这是行业惯例（Cursor / Cline / Continue 都这样）
 *
 * 流程：
 * 1. 用户填 Key，加密存到 VS Code SecretStorage
 * 2. 扩展用 Key 时从 SecretStorage 读取
 * 3. 用户花的是自己的钱，开发者 0 成本
 *
 * SecretStorage 是 VS Code 提供的加密存储 API
 * 比明文存在 settings.json 安全得多
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 配置优先级（三层，从高到低）
 *
 *   1. 项目根 .env 文件      —— 开发调试用，不进仓库
 *   2. VS Code 设置界面      —— package.json 里声明的 mini-coder.*
 *   3. SecretStorage        —— 用户通过命令面板填的（加密存储）
 *
 * 修复记录（2026-10-21）：
 *   之前 package.json 声明了 mini-coder.provider / mini-coder.model，
 *   但本文件从头到尾没调用过 vscode.workspace.getConfiguration()，
 *   用户在设置界面改这两项完全没有任何效果 —— 典型的"配置项骗用户"。
 *   现在三层真正打通，并在 /doctor 里显示实际生效值。
 *
 *   同时修了第二个同类 bug：MINI_CODER_BASE_URL 在 .env 里写了也没人读，
 *   导致 MiniMax 国内站/国际站无法通过配置切换（见 loadFromEnv）。
 * ─────────────────────────────────────────────────────────────
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const SECRET_API_KEY = 'miniCoderApiKey';
const STATE_PROVIDER = 'miniCoderProvider';

export type ProviderName = 'minimax' | 'deepseek' | 'openai' | 'ollama';

export interface ProviderConfig {
  baseUrl: string;
  defaultModel: string;
}

/**
 * ⚠️ MiniMax 国内/国际是两个完全独立的平台，key 不通用：
 *   - 国际站（platform.minimax.io）  → https://api.minimax.io/v1
 *   - 国内站（platform.minimaxi.com） → https://api.minimaxi.com/v1   ← 注意末尾多一个 i
 *
 *   国内账号的 key 打到国际站会返回 401 invalid api key (2049)。
 *   如果你的 key 是在国内站申请的，这里必须用 minimaxi.com。
 *   （也可以在 .env 或 VS Code 设置里写 baseUrl 显式覆盖）
 */
export const PROVIDER_CONFIGS: Record<ProviderName, ProviderConfig> = {
  minimax: {
    // 默认按【国内站】配置——国内开发者绝大多数是 minimaxi.com 账号。
    // 国际站用户请设 MINI_CODER_BASE_URL=https://api.minimax.io/v1
    baseUrl: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-M3',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder:7b',
  },
};

/**
 * 合法 provider 名单 —— 从 PROVIDER_CONFIGS 的 key 推导，不手写第二份
 *
 * ⚠️ 2026-10-22 修复的"配置项骗用户"：
 *   之前这里是一份手写的 `['minimax','deepseek','openai','ollama']`，
 *   而 package.json 的 enum 写了 5 个（含 anthropic）。
 *   用户在设置界面选了 anthropic → 这里判定不合法 → 静默丢弃 →
 *   回落到默认值 deepseek。用户以为在用 Claude，账单却出在 DeepSeek 上。
 *
 *   两份名单只要有一处不同步，就会出现这个 bug，而且没有任何报错。
 *   所以现在只保留 PROVIDER_CONFIGS 这一个真相源：
 *   以后加 provider 只需要改上面那张表，这里自动跟着变。
 */
const VALID_PROVIDERS = Object.keys(PROVIDER_CONFIGS) as ProviderName[];

/** .env 里可能出现的 key 名（任选其一） */
const API_KEY_NAMES = ['MINIMAX_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'LLM_API_KEY'];

interface EnvConfig {
  key?: string;
  provider?: ProviderName;
  model?: string;
  baseUrl?: string;
}

export class ConfigManager {
  constructor(private context: vscode.ExtensionContext) {}

  /**
   * 从项目根目录的 .env 文件读取配置（优先级最高）
   *
   * 用途：开发时不用每次 F5 都填 key
   * 安全：.env 已在 .gitignore 里，不会被 commit
   *
   * 支持的键：
   *   MINIMAX_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY / LLM_API_KEY
   *   MINI_CODER_PROVIDER   （minimax / deepseek / openai / ollama）
   *   MINI_CODER_MODEL
   *   MINI_CODER_BASE_URL   ⭐ 之前声明了但没人读，导致无法切换 MiniMax 站点
   */
  private loadFromEnv(): EnvConfig {
    const envPath = path.join(this.context.extensionPath, '.env');
    if (!fs.existsSync(envPath)) return {};

    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      const result: EnvConfig = {};

      for (const rawLine of content.split('\n')) {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;

        const key = trimmed.slice(0, eqIdx).trim();
        // 去掉可能存在的引号（.env 常见写法：KEY="value" 或 KEY='value'）
        let value = trimmed.slice(eqIdx + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
          (value.startsWith("'") && value.endsWith("'") && value.length > 1)
        ) {
          value = value.slice(1, -1);
        }
        if (!value) continue;

        if (API_KEY_NAMES.includes(key)) {
          result.key = value;
        } else if (key === 'MINI_CODER_PROVIDER') {
          if (VALID_PROVIDERS.includes(value as ProviderName)) {
            result.provider = value as ProviderName;
          }
        } else if (key === 'MINI_CODER_MODEL') {
          result.model = value;
        } else if (key === 'MINI_CODER_BASE_URL') {
          result.baseUrl = value;
        }
      }

      return result;
    } catch {
      return {};
    }
  }

  /**
   * 读 VS Code 设置界面里的配置（package.json contributions.configuration 声明的项）
   *
   * ⚠️ 之前全项目从没调用过 getConfiguration —— 设置界面改了不起作用。
   *   现在这里真正接上了，优先级低于 .env、高于 SecretStorage。
   */
  private loadFromSettings(): EnvConfig {
    const result: EnvConfig = {};
    try {
      const cfg = vscode.workspace.getConfiguration('mini-coder');

      const provider = cfg.get<string>('provider');
      if (provider && VALID_PROVIDERS.includes(provider as ProviderName)) {
        result.provider = provider as ProviderName;
      }

      const model = cfg.get<string>('model');
      if (model) result.model = model;

      const baseUrl = cfg.get<string>('baseUrl');
      if (baseUrl) result.baseUrl = baseUrl;

      return result;
    } catch {
      return {};
    }
  }

  /** 弹窗让用户填 Key 并保存（存 SecretStorage，加密） */
  async promptAndSaveApiKey(): Promise<boolean> {
    const key = await vscode.window.showInputBox({
      prompt: '请输入你的 LLM API Key（加密存储，不会上传）',
      placeHolder: 'sk-xxxx...',
      password: true,
      ignoreFocusOut: true,
    });
    if (!key) return false;

    await this.context.secrets.store(SECRET_API_KEY, key);
    vscode.window.showInformationMessage('✓ API Key 已保存');
    return true;
  }

  async getApiKey(): Promise<string | undefined> {
    return this.context.secrets.get(SECRET_API_KEY);
  }

  /** 让用户选 Provider（base_url + model），结果同时写回设置界面 */
  async promptAndSaveProvider(): Promise<ProviderName | undefined> {
    const items: vscode.QuickPickItem[] = VALID_PROVIDERS.map((p) => ({
      label: p,
      description: `${PROVIDER_CONFIGS[p].defaultModel} (${PROVIDER_CONFIGS[p].baseUrl})`,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: '选择 LLM Provider',
    });
    if (!picked) return undefined;

    const chosen = picked.label as ProviderName;

    // 同步写回设置界面，保证 /doctor 显示的和实际生效的一致
    try {
      await vscode.workspace
        .getConfiguration('mini-coder')
        .update('provider', chosen, vscode.ConfigurationTarget.Global);
    } catch {
      // 设置写入失败不影响主流程（.env 优先级更高）
    }
    await this.context.globalState.update(STATE_PROVIDER, chosen);
    return chosen;
  }

  /**
   * 取当前生效的 Provider
   * 优先级：.env > VS Code 设置 > 向导选过的 globalState > 'deepseek'
   */
  async getProvider(): Promise<ProviderName> {
    const env = this.loadFromEnv();
    if (env.provider) return env.provider;

    const settings = this.loadFromSettings();
    if (settings.provider) return settings.provider;

    const saved = this.context.globalState.get<ProviderName>(STATE_PROVIDER);
    return saved || 'deepseek';
  }

  /**
   * 检查是否配置好，没配置就引导
   * 返回 {key, config} 或 undefined
   */
  async ensureConfigured(): Promise<{ key: string; config: ProviderConfig } | undefined> {
    const env = this.loadFromEnv();
    const settings = this.loadFromSettings();

    const provider = env.provider ?? settings.provider ?? (await this.getProvider());

    // 模型名：.env > 设置 > provider 默认
    const base: ProviderConfig = PROVIDER_CONFIGS[provider] ?? PROVIDER_CONFIGS.deepseek;
    const model = env.model ?? settings.model ?? base.defaultModel;

    // baseUrl：.env > 设置 > provider 默认
    // 这一层之前完全缺失，导致 .env 里写 MINI_CODER_BASE_URL 不起作用
    const baseUrl = env.baseUrl ?? settings.baseUrl ?? base.baseUrl;

    const config: ProviderConfig = { baseUrl, defaultModel: model };

    let key = env.key || (await this.getApiKey());

    if (!key && provider !== 'ollama') {
      const action = await vscode.window.showInformationMessage(
        '请先设置 LLM API Key',
        '立即设置',
        '取消',
      );
      if (action !== '立即设置') return undefined;
      const saved = await this.promptAndSaveApiKey();
      if (!saved) return undefined;
      key = await this.getApiKey();
    }

    if (!key) {
      vscode.window.showErrorMessage('未配置 API Key');
      return undefined;
    }

    return { key, config };
  }

  /**
   * 返回当前实际生效的配置（/doctor 用）
   * 让用户能一眼看到"我现在到底用的哪个 provider / 哪个模型 / 哪个地址"
   */
  describeEffective(): {
    provider: ProviderName;
    model: string;
    baseUrl: string;
    keyFromEnv: boolean;
  } {
    const env = this.loadFromEnv();
    const settings = this.loadFromSettings();

    const provider =
      env.provider ??
      settings.provider ??
      this.context.globalState.get<ProviderName>(STATE_PROVIDER) ??
      'deepseek';
    const base: ProviderConfig = PROVIDER_CONFIGS[provider] ?? PROVIDER_CONFIGS.deepseek;

    return {
      provider,
      model: env.model ?? settings.model ?? base.defaultModel,
      baseUrl: env.baseUrl ?? settings.baseUrl ?? base.baseUrl,
      keyFromEnv: !!env.key,
    };
  }
}
