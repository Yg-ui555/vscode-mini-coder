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

export const PROVIDER_CONFIGS: Record<ProviderName, ProviderConfig> = {
  minimax: {
    baseUrl: 'https://api.minimax.io/v1',
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

export class ConfigManager {
  constructor(private context: vscode.ExtensionContext) {}

  /**
   * 从项目根目录的 .env 文件读取配置
   * 优先级：.env > SecretStorage
   *
   * 用途：开发时不用每次 F5 都填 key
   * 安全：.env 已在 .gitignore 里，不会被 commit
   *
   * .env 文件格式（每行 KEY=VALUE）：
   *   MINIMAX_API_KEY=sk-xxx
   *   MINI_CODER_PROVIDER=minimax
   *   MINI_CODER_MODEL=MiniMax-M3
   */
  private loadFromEnv(): {
    key?: string;
    provider?: ProviderName;
    model?: string;
  } {
    const envPath = path.join(this.context.extensionPath, '.env');
    if (!fs.existsSync(envPath)) return {};

    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      const result: { key?: string; provider?: ProviderName; model?: string } = {};

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;

        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();

        if (
          key === 'MINIMAX_API_KEY' ||
          key === 'DEEPSEEK_API_KEY' ||
          key === 'OPENAI_API_KEY' ||
          key === 'LLM_API_KEY'
        ) {
          result.key = value;
        } else if (key === 'MINI_CODER_PROVIDER') {
          if (['minimax', 'deepseek', 'openai', 'ollama'].includes(value)) {
            result.provider = value as ProviderName;
          }
        } else if (key === 'MINI_CODER_MODEL') {
          result.model = value;
        }
      }

      return result;
    } catch {
      return {};
    }
  }

  /** 弹窗让用户填 Key 并保存 */
  async promptAndSaveApiKey(): Promise<boolean> {
    const key = await vscode.window.showInputBox({
      prompt: '请输入你的 LLM API Key（加密存储）',
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

  /** 让用户选 Provider（base_url + model） */
  async promptAndSaveProvider(): Promise<ProviderName | undefined> {
    const items: vscode.QuickPickItem[] = (Object.keys(PROVIDER_CONFIGS) as ProviderName[]).map(
      (p) => ({
        label: p,
        description: `${PROVIDER_CONFIGS[p].defaultModel} (${PROVIDER_CONFIGS[p].baseUrl})`,
      }),
    );

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: '选择 LLM Provider',
    });
    if (!picked) return undefined;

    await this.context.globalState.update(STATE_PROVIDER, picked.label);
    return picked.label as ProviderName;
  }

  async getProvider(): Promise<ProviderName> {
    const saved = this.context.globalState.get<ProviderName>(STATE_PROVIDER);
    return saved || 'deepseek';
  }

  /**
   * 检查是否配置好，没配置就引导
   * 返回 {key, config} 或 undefined
   */
  async ensureConfigured(): Promise<{ key: string; config: ProviderConfig } | undefined> {
    // 优先读 .env（开发时省去弹窗）
    const env = this.loadFromEnv();

    let provider = env.provider || (await this.getProvider());
    let key = env.key || (await this.getApiKey());

    // 模型名也支持 .env 覆盖
    const config: ProviderConfig = env.model
      ? { ...PROVIDER_CONFIGS[provider], defaultModel: env.model }
      : PROVIDER_CONFIGS[provider];

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
}