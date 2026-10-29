/**
 * ConfigManager 配置解析测试（2026-10-29 加）
 *
 * ⭐ 为什么这层必须有测试
 *
 *   2026-10-29 一次性挖出三个真 bug，而且它们【全是静默的】：
 *
 *   ① `.env` 读的是【扩展安装目录】，不是工作区根
 *      → "在项目根 .env 里配 key"这个功能等于没有，
 *        而 README 和 /doctor 都在教用户那么做。
 *   ② provider / model / baseUrl / key 各算各的
 *      → /doctor 显示的那一套，和真正发请求用的那一套可能不是同一个
 *        （典型的"配置项骗用户"）。
 *   ③ .env 里放两把 key 时"谁在后面谁赢"
 *      → 拿 MiniMax 的 key 去打 DeepSeek，服务端只回一个没有信息量的 401。
 *
 *   这三个 bug 都不报错、不抛异常，只是"结果不对"——
 *   没有测试盯着，下次重构还会再犯。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from '../config';
// 直接 import stub（和 vitest.config.mts 的 alias 指向同一个文件 → 同一个模块实例）
import * as vscodeStub from './stubs/vscode-stub';

let tmp: string;
let settings: Record<string, any>;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minicoder-cfg-'));
  settings = {};
  (vscodeStub.workspace as any).workspaceFolders = [{ uri: { fsPath: tmp } }];
  (vscodeStub.workspace as any).getConfiguration = () => ({ get: (k: string) => settings[k] });

  // 清掉进程环境变量，免得测试结果受跑测试的机器影响
  savedEnv = {};
  for (const k of [
    'MINIMAX_API_KEY',
    'DEEPSEEK_API_KEY',
    'OPENAI_API_KEY',
    'LLM_API_KEY',
    'MINI_CODER_PROVIDER',
    'MINI_CODER_MODEL',
    'MINI_CODER_BASE_URL',
  ]) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  (vscodeStub.workspace as any).workspaceFolders = undefined;
  (vscodeStub.workspace as any).getConfiguration = () => ({ get: () => undefined });
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

/** 造一个假的 ExtensionContext */
function makeCtx() {
  const mem: Record<string, any> = {};
  return {
    extensionPath: path.join(tmp, 'ext-not-exist'),
    secrets: {
      get: async (k: string) => mem['secret:' + k],
      store: async (k: string, v: string) => {
        mem['secret:' + k] = v;
      },
    },
    globalState: {
      get: (k: string) => mem['state:' + k],
      update: async (k: string, v: any) => {
        mem['state:' + k] = v;
      },
    },
  } as any;
}

function writeEnv(content: string) {
  fs.writeFileSync(path.join(tmp, '.env'), content, 'utf-8');
}

describe('ConfigManager · .env 读哪', () => {
  it('⭐ 从【工作区根】读，而不是扩展安装目录', async () => {
    writeEnv('MINIMAX_API_KEY=sk-mm\n');
    // key 必须和 provider 配套 —— 当前 provider 是 minimax，所以要用 MiniMax 那把
    settings['provider'] = 'minimax';

    const cm = new ConfigManager(makeCtx());
    const eff = await cm.getEffective();
    expect(eff.envPath).toBe(path.join(tmp, '.env'));
    expect(eff.key).toBe('sk-mm');
  });

  it('⭐ .env 里有 key 但 provider 对不上 → 不用它（这正是新规则）', async () => {
    writeEnv('MINIMAX_API_KEY=sk-mm\n');
    // 没设 provider → 默认 deepseek，而 .env 里只有 MiniMax 的 key
    const cm = new ConfigManager(makeCtx());
    const eff = await cm.getEffective();
    expect(eff.provider).toBe('deepseek');
    expect(eff.key).toBeUndefined();
  });

  it('工作区根没有 .env 时不报错（回落 SecretStorage）', async () => {
    const cm = new ConfigManager(makeCtx());
    const eff = await cm.getEffective();
    expect(eff.envPath).toBeUndefined();
    expect(eff.key).toBeUndefined();
  });
});

describe('ConfigManager · provider 优先级', () => {
  it('⭐ 设置界面 > .env > 上次向导选择', async () => {
    writeEnv('MINI_CODER_PROVIDER=deepseek\n');
    const cm = new ConfigManager(makeCtx());

    // 设置界面选了 minimax → 它赢
    settings['provider'] = 'minimax';
    let eff = await cm.getEffective();
    expect(eff.provider).toBe('minimax');
    expect(eff.providerSource).toBe('settings');

    // 设置界面没选 → .env 赢
    settings = {};
    eff = await cm.getEffective();
    expect(eff.provider).toBe('deepseek');
    expect(eff.providerSource).toBe('env');
  });

  it('两处都没有 → 走向导选过的那个，再没有就 deepseek', async () => {
    const ctx = makeCtx();
    await ctx.globalState.update('miniCoderProvider', 'openai');
    const cm = new ConfigManager(ctx);
    let eff = await cm.getEffective();
    expect(eff.provider).toBe('openai');
    expect(eff.providerSource).toBe('state');

    const cm2 = new ConfigManager(makeCtx());
    eff = await cm2.getEffective();
    expect(eff.provider).toBe('deepseek');
  });
});

describe('ConfigManager · key 必须和 provider 配套', () => {
  it('⭐ minimax 就用 MiniMax 那把，deepseek 就用 DeepSeek 那把', async () => {
    writeEnv('MINIMAX_API_KEY=sk-mm\nDEEPSEEK_API_KEY=sk-ds\n');
    const cm = new ConfigManager(makeCtx());

    settings['provider'] = 'minimax';
    let eff = await cm.getEffective();
    expect(eff.key).toBe('sk-mm');
    expect(eff.keySource).toBe('env');

    settings['provider'] = 'deepseek';
    eff = await cm.getEffective();
    expect(eff.key).toBe('sk-ds');
  });

  it('⭐ 没有配套的 key 时【不拿别的 provider 的 key 顶替】', async () => {
    // 只有 DeepSeek 的 key，但当前 provider 是 minimax
    writeEnv('DEEPSEEK_API_KEY=sk-ds\n');
    settings['provider'] = 'minimax';

    const cm = new ConfigManager(makeCtx());
    const eff = await cm.getEffective();
    expect(eff.key).toBeUndefined();
  });

  it('.env 里没有 → 回落到 SecretStorage', async () => {
    const ctx = makeCtx();
    await ctx.secrets.store('miniCoderApiKey', 'sk-secret');
    const cm = new ConfigManager(ctx);
    const eff = await cm.getEffective();
    expect(eff.key).toBe('sk-secret');
    expect(eff.keySource).toBe('secret');
  });

  it('.env 优先于 SecretStorage（.env 是开发者本地显式写的）', async () => {
    writeEnv('MINIMAX_API_KEY=sk-env\n');
    settings['provider'] = 'minimax';
    const ctx = makeCtx();
    await ctx.secrets.store('miniCoderApiKey', 'sk-secret');

    const cm = new ConfigManager(ctx);
    const eff = await cm.getEffective();
    expect(eff.key).toBe('sk-env');
    expect(eff.keySource).toBe('env');
  });

  it('⭐ SecretStorage 里的 key 归属和当前 provider 一致 → 正常用', async () => {
    const ctx = makeCtx();
    await ctx.secrets.store('miniCoderApiKey', 'sk-secret');
    await ctx.globalState.update('miniCoderKeyProvider', 'deepseek');
    settings['provider'] = 'deepseek';

    const cm = new ConfigManager(ctx);
    const eff = await cm.getEffective();
    expect(eff.key).toBe('sk-secret');
    expect(eff.keySource).toBe('secret');
    expect(eff.foreignSecret).toBeFalsy();
  });

  it('⭐ SecretStorage 里的 key 属于【别的 provider】→ 不拿它顶替', async () => {
    // 用户填过一把 MiniMax 的 key，后来把 provider 切成了 DeepSeek
    const ctx = makeCtx();
    await ctx.secrets.store('miniCoderApiKey', 'sk-minimax');
    await ctx.globalState.update('miniCoderKeyProvider', 'minimax');
    settings['provider'] = 'deepseek';

    const cm = new ConfigManager(ctx);
    const eff = await cm.getEffective();
    expect(eff.key).toBeUndefined();
    expect(eff.foreignSecret).toBe(true);
    expect(eff.secretProvider).toBe('minimax');
  });

  it('老版本存的 key（没记归属）→ 照旧能用（向后兼容）', async () => {
    const ctx = makeCtx();
    await ctx.secrets.store('miniCoderApiKey', 'sk-legacy');
    settings['provider'] = 'deepseek';

    const cm = new ConfigManager(ctx);
    const eff = await cm.getEffective();
    expect(eff.key).toBe('sk-legacy');
    expect(eff.foreignSecret).toBeFalsy();
  });
});

describe('ConfigManager · model / baseUrl', () => {
  it('⭐ 没有显式配置时用 provider 的默认值（不会串到别家的模型名）', async () => {
    const cm = new ConfigManager(makeCtx());
    settings['provider'] = 'minimax';
    const eff = await cm.getEffective();
    expect(eff.model).toBe('MiniMax-M3');
    expect(eff.baseUrl).toBe('https://api.minimaxi.com/v1');
  });

  it('设置界面显式指定的 model / baseUrl 优先', async () => {
    const cm = new ConfigManager(makeCtx());
    settings['provider'] = 'minimax';
    settings['model'] = 'MiniMax-M2';
    settings['baseUrl'] = 'https://api.minimax.io/v1';
    const eff = await cm.getEffective();
    expect(eff.model).toBe('MiniMax-M2');
    expect(eff.baseUrl).toBe('https://api.minimax.io/v1');
  });
});
