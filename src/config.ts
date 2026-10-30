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
import providerDefaults from './providers.json';

const SECRET_API_KEY = 'miniCoderApiKey';
const STATE_PROVIDER = 'miniCoderProvider';
/**
 * ⭐ SecretStorage 里那把 key 属于哪个 provider（2026-10-29 加）
 *
 *   为什么必须记：
 *     SecretStorage 只有一个槽位，存的是"用户最后一次填进去的 key"。
 *     用户填完 MiniMax 的 key、之后把 provider 切到 DeepSeek，
 *     这把 MiniMax 的 key 就会自动被拿去打 DeepSeek —— 得到一个
 *     信息量为零的 401（"authorized_error"），永远不会提示"你拿错家了"。
 *
 *   类比：钥匙串上只有一把钥匙，但钥匙上没有标签。
 *         换了一把锁以后，你只能硬插 —— 插不进去，
 *         锁也不会告诉你"这把是别的门的"。
 *
 *   所以保存 key 时顺手记下它属于哪家，换 provider 后就不拿它顶替。
 */
const STATE_KEY_PROVIDER = 'miniCoderKeyProvider';

export interface ProviderConfig {
  baseUrl: string;
  defaultModel: string;
}

/**
 * ⭐ provider 默认配置的【唯一真相源】= src/providers.json
 *
 *   为什么不是这个文件里写死：
 *     以前这张表在【四个地方】各写一份 ——
 *       · src/config.ts（本文件，插件运行时用）
 *       · src/eval/cli.ts（评测 CLI 用）
 *       · scripts/auditProject.js（项目体检脚本用）
 *       · scripts/checkApiKey.js（API 连通性自检用）
 *     改一处忘三处 → 插件用 MiniMax、评测打 DeepSeek，
 *     而且【没有任何报错】—— 这就是典型的"配置项骗用户"。
 *
 *   现在只有 src/providers.json 一份，四处都从它读：
 *     · TS 侧用 import（resolveJsonModule 已开）
 *     · JS 侧用 require()
 *
 *   ⚠️ MiniMax 国内/国际是两个完全独立的平台，key 不通用：
 *   - 国际站（platform.minimax.io）  → https://api.minimax.io/v1
 *   - 国内站（platform.minimaxi.com） → https://api.minimaxi.com/v1   ← 注意末尾多一个 i
 *
 *   国内账号的 key 打到国际站会返回 401 invalid api key (2049)。
 *   如果你的 key 是在国内站申请的，这里必须用 minimaxi.com。
 *   （也可以在 .env 或 VS Code 设置里写 baseUrl 显式覆盖）
 *
 *   默认按【国内站】配置——国内开发者绝大多数是 minimaxi.com 账号。
 *   国际站用户请设 MINI_CODER_BASE_URL=https://api.minimax.io/v1
 */
export const PROVIDER_CONFIGS: Record<ProviderName, ProviderConfig> = providerDefaults;

/**
 * provider 名单直接从真相源推导，不手写第二份
 *
 *   加一个 provider = 在 src/providers.json 里加一条，下游代码自动跟着变；
 *   package.json 的 enum 由 checkProject.js 的 checkProviderEnum 守卫盯着。
 */
export type ProviderName = keyof typeof providerDefaults;

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

/** .env / 环境变量里可能出现的 key 名（任选其一） */
const API_KEY_NAMES = ['MINIMAX_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'LLM_API_KEY'];

/**
 * ⭐ 每个 provider 该配哪把 key（2026-10-29 加）
 *
 *   为什么必须按 provider 归类：
 *     .env 里同时放 MiniMax 和 DeepSeek 两把 key 时，如果"谁在后面谁赢"，
 *     就会出现【拿 MiniMax 的 key 去打 DeepSeek】这种组合 —— 服务端只会回你一个
 *     401 authorized_error，而错误信息完全不会告诉你"key 配错家了"。
 *
 *   类比：钥匙串上每把钥匙，MiniMax 的钥匙插进 DeepSeek 的锁，
 *         锁只会说"钥匙不对"，不会说"你拿错那把了"。
 */
const PROVIDER_KEY_NAMES: Record<ProviderName, string[]> = {
  minimax: ['MINIMAX_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  ollama: [], // 本地模型不需要 key
};

/** 不挑 provider 的通用 key（谁都能用，优先级低于上面那把） */
const GENERIC_KEY_NAMES = ['LLM_API_KEY'];

interface EnvConfig {
  /** 按 provider 归类的 key */
  keys?: Partial<Record<ProviderName, string>>;
  /** 不挑 provider 的通用 key */
  genericKey?: string;
  provider?: ProviderName;
  model?: string;
  baseUrl?: string;
  /** 实际读到的 .env 路径（给 /doctor 展示用） */
  path?: string;
}

/**
 * ⭐ 一次算清所有生效配置（2026-10-29 加）
 *
 *   为什么要有这个"单一真相源"：
 *     之前 provider / model / baseUrl / key 各算各的（loadFromEnv / loadFromSettings /
 *     globalState 各管一段），/doctor 显示的那一套和真正发请求用的那一套
 *     **可能不是同一个** —— 这就是典型的"配置项骗用户"：
 *     状态栏写着 minimax，实际打的是 deepseek 的地址。
 *
 *   现在只有一个函数算配置，/doctor 展示它、请求也用它，不可能再对不上。
 */
export interface EffectiveConfig {
  provider: ProviderName;
  model: string;
  baseUrl: string;
  key?: string;
  /** key 从哪来 —— /doctor 要告诉用户"该改哪里" */
  keySource: 'env' | 'secret' | 'none';
  /** provider 从哪来 */
  providerSource: 'settings' | 'env' | 'state';
  /** 读到的 .env 路径（如果有） */
  envPath?: string;
  /**
   * SecretStorage 里那把 key 记录的 provider（没记录过 = 老版本存的，不确定）
   *
   * 有了它，/doctor 才能说清楚"你换 provider 了，key 还是上一家的"。
   */
  secretProvider?: ProviderName;
  /**
   * ⭐ SecretStorage 里有 key，但它属于别的 provider —— 所以【没有拿来用】
   *
   *   为 true 时：key 为 undefined，插件会引导用户重新设置一把。
   *   这比"拿外家 key 硬打、换来一个没有信息量的 401"要好得多。
   */
  foreignSecret?: boolean;
}

export class ConfigManager {
  constructor(private context: vscode.ExtensionContext) {}

  /**
   * 读配置（优先级：项目根 .env 文件 > 进程环境变量）
   *
   * 用途：开发时不用每次 F5 都填 key
   * 安全：.env 已在 .gitignore 里，不会被 commit
   *
   * 支持的键：
   *   MINIMAX_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY / LLM_API_KEY
   *   MINI_CODER_PROVIDER   （minimax / deepseek / openai / ollama）
   *   MINI_CODER_MODEL
   *   MINI_CODER_BASE_URL   ⭐ 之前声明了但没人读，导致无法切换 MiniMax 站点
   *
   * ⭐ 进程环境变量也认（2026-10-28）
   *
   *   CI 的 secret、`docker -e`、终端里 `export DEEPSEEK_API_KEY=...`，
   *   走的都是环境变量。之前这里【只】读 .env 文件，于是：
   *     · CI 里 secret 明明注进去了，评测却报"找不到 API Key"
   *     · 在终端里 export 过的用户，打开插件照样被提示没配 key
   *       （.env 是按 extensionPath 找的，而扩展可能装在别处）
   *
   *   .env 排在前面：它是开发者本地显式写的，应该赢过环境变量。
   */
  /**
   * ⭐ 找 .env 文件（2026-10-29 修）
   *
   *   ⚠️ 修复记录：原来读的是【扩展安装目录】里的 .env ——
   *     那是 `code --install-extension` 装出来的目录，用户根本不会往那儿放 .env，
   *     于是"在项目根 .env 里配 key"这个功能【等于没有】，
   *     而 README 和 /doctor 都在教用户去项目根放 .env。
   *     代码和文档说的不是一回事 —— 这正是本项目最恨的那类 bug。
   *
   *   现在按文档来：先找【工作区根目录】，找不到再退回扩展安装目录。
   */
  private findEnvFile(): string | undefined {
    const candidates: string[] = [];

    try {
      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length) {
        candidates.push(path.join(folders[0].uri.fsPath, '.env'));
      }
    } catch {
      /* 没有 vscode 工作区（测试环境）就跳过 */
    }
    candidates.push(path.join(this.context.extensionPath, '.env'));

    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        /* 忽略 */
      }
    }
    return undefined;
  }

  /**
   * 读配置（.env 文件 > 进程环境变量）
   *
   * 用途：开发时不用每次 F5 都填 key
   * 安全：.env 已在 .gitignore 里，不会被 commit
   *
   * 支持的键：
   *   MINIMAX_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY / LLM_API_KEY
   *   MINI_CODER_PROVIDER   （minimax / deepseek / openai / ollama）
   *   MINI_CODER_MODEL
   *   MINI_CODER_BASE_URL   ⭐ 之前声明了但没人读，导致无法切换 MiniMax 站点
   *
   * ⭐ 进程环境变量也认（2026-10-28）
   *
   *   CI 的 secret、`docker -e`、终端里 `export DEEPSEEK_API_KEY=...`，
   *   走的都是环境变量。之前这里【只】读 .env 文件，于是：
   *     · CI 里 secret 明明注进去了，评测却报"找不到 API Key"
   *     · 在终端里 export 过的用户，打开插件照样被提示没配 key
   *
   *   .env 排在前面：它是开发者本地显式写的，应该赢过环境变量。
   */
  private loadFromEnv(): EnvConfig {
    const result: EnvConfig = {};

    // ── 第 1 优先：.env 文件（工作区根优先）──
    const envPath = this.findEnvFile();
    if (envPath) {
      result.path = envPath;
      try {
        const content = fs.readFileSync(envPath, 'utf-8');

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

          // ⭐ key 按 provider 归类 —— .env 里放两把 key 也不会串
          const matched = (Object.keys(PROVIDER_KEY_NAMES) as ProviderName[]).find((p) =>
            PROVIDER_KEY_NAMES[p].includes(key),
          );
          if (matched) {
            result.keys = result.keys || {};
            result.keys[matched] = value;
          } else if (GENERIC_KEY_NAMES.includes(key)) {
            result.genericKey = value;
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
      } catch {
        /* 读不了就当没有这一份 */
      }
    }

    // ── 第 2 优先：进程环境变量 ──
    //   只补【.env 里没有的】项 —— .env 是开发者本地显式写的，应该赢。
    const envKeyName = API_KEY_NAMES.find((n) => process.env[n]);
    if (envKeyName) {
      const matched = (Object.keys(PROVIDER_KEY_NAMES) as ProviderName[]).find((p) =>
        PROVIDER_KEY_NAMES[p].includes(envKeyName),
      );
      if (matched) {
        result.keys = result.keys || {};
        if (!result.keys[matched]) result.keys[matched] = process.env[envKeyName];
      } else if (!result.genericKey) {
        result.genericKey = process.env[envKeyName];
      }
    }
    const envProvider = process.env.MINI_CODER_PROVIDER;
    if (!result.provider && envProvider && VALID_PROVIDERS.includes(envProvider as ProviderName)) {
      result.provider = envProvider as ProviderName;
    }
    if (!result.model && process.env.MINI_CODER_MODEL) result.model = process.env.MINI_CODER_MODEL;
    if (!result.baseUrl && process.env.MINI_CODER_BASE_URL) {
      result.baseUrl = process.env.MINI_CODER_BASE_URL;
    }

    return result;
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

    // ⭐ 顺手记下"这把 key 属于哪家" —— 换 provider 后就不拿它顶替
    try {
      const provider = (await this.getEffective()).provider;
      await this.context.globalState.update(STATE_KEY_PROVIDER, provider);
    } catch {
      /* 记不住也不影响主流程 */
    }

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
   * ⭐⭐⭐ 一次算清所有生效配置（2026-10-29）
   *
   *   为什么必须有这个"单一真相源"：
   *     之前 provider / model / baseUrl / key 各算各的（loadFromEnv / loadFromSettings /
   *     globalState 各管一段），/doctor 显示的那一套 和 真正发请求用的那一套
   *     【可能不是同一个】—— 这就是典型的"配置项骗用户"：
   *     状态栏写着 minimax，实际打的是 deepseek 的地址。
   *
   *     现在只有一个函数算配置，/doctor 展示它、请求也用它，不可能再对不上。
   *
   *   ⭐ 优先级规则（2026-10-29 调整过一次）：
   *     provider / model / baseUrl ：设置界面 > .env > provider 默认值
   *       —— 【设置界面排第一】的理由：用户在界面上看到的就是生效的。
   *          .env 是给命令行评测（npm run eval）用的项目级配置，
   *          拿它去盖掉用户在界面上的显式选择，就是"配置项骗用户"。
   *     key                       ：.env 里【与该 provider 匹配】的那把
   *                                > .env 里的通用 key > SecretStorage
   *       —— key 必须和 provider 配套。拿 A 家的 key 打 B 家，
   *          服务端只会回一个没有信息量的 401 authorized_error，
   *          永远不会告诉你"你拿错那把钥匙了"。
   */
  async getEffective(): Promise<EffectiveConfig> {
    const env = this.loadFromEnv();
    const settings = this.loadFromSettings();

    // ── provider ──
    let provider: ProviderName = 'deepseek';
    let providerSource: EffectiveConfig['providerSource'] = 'state';
    if (settings.provider) {
      provider = settings.provider;
      providerSource = 'settings';
    } else if (env.provider) {
      provider = env.provider;
      providerSource = 'env';
    } else {
      const saved = this.context.globalState.get<ProviderName>(STATE_PROVIDER);
      if (saved) {
        provider = saved;
        providerSource = 'state';
      }
    }

    const base: ProviderConfig = PROVIDER_CONFIGS[provider] ?? PROVIDER_CONFIGS.deepseek;

    // ── model / baseUrl ──
    //   这一层之前完全缺失，导致 .env 里写 MINI_CODER_BASE_URL 不起作用
    const model = settings.model || env.model || base.defaultModel;
    const baseUrl = settings.baseUrl || env.baseUrl || base.baseUrl;

    // ── key（按 provider 配对）──
    let key = env.keys?.[provider];
    let keySource: EffectiveConfig['keySource'] = key ? 'env' : 'none';
    if (!key && env.genericKey) {
      key = env.genericKey;
      keySource = 'env';
    }

    // ── SecretStorage 回落（要检查归属）──
    //   SecretStorage 只有一个槽位，key 没写"属于哪家"。
    //   换 provider 后拿上一家的 key 硬打，只会得到一个没有信息量的 401。
    let secretProvider: ProviderName | undefined;
    let foreignSecret = false;
    if (!key) {
      const secret = await this.getApiKey();
      if (secret) {
        secretProvider = this.context.globalState.get<ProviderName>(STATE_KEY_PROVIDER);
        if (!secretProvider || secretProvider === provider) {
          // 没记录过归属（老版本存的）→ 照旧用；记录过且一致 → 用
          key = secret;
          keySource = 'secret';
        } else {
          // ⭐ 记录过、但属于别的 provider → 不顶替
          foreignSecret = true;
        }
      }
    }

    return {
      provider,
      model,
      baseUrl,
      key,
      keySource,
      providerSource,
      envPath: env.path,
      secretProvider,
      foreignSecret,
    };
  }

  /**
   * 取当前生效的 Provider
   * （provider 的解析规则见 getEffective 的注释）
   */
  async getProvider(): Promise<ProviderName> {
    return (await this.getEffective()).provider;
  }

  /**
   * 检查是否配置好，没配置就引导
   * 返回 {key, config} 或 undefined
   */
  async ensureConfigured(): Promise<{ key: string; config: ProviderConfig } | undefined> {
    const eff = await this.getEffective();
    const config: ProviderConfig = { baseUrl: eff.baseUrl, defaultModel: eff.model };

    let key = eff.key;

    if (!key && eff.provider !== 'ollama') {
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
