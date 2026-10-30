#!/usr/bin/env node
/**
 * API 连通性自检（终端版）
 *
 * ⭐ 为什么要有这个
 *
 *   2026-10-29 用户卡了大半天：插件报「API 配额不足或无权限」，
 *   日志写「余额用完」，两边对不上，最后是他自己拿 key 打接口
 *   才定位到【账上没钱】。
 *
 *   插件里的 /doctor 已经能真打一次接口了，但 /doctor 在 VS Code 里，
 *   想在提交代码前、在 CI 里、在换 provider 时快速验一把，还是不方便。
 *
 *   这个脚本干同一件事，但：
 *     · 在终端里跑，改完 .env 立刻能验
 *     · 输出直接给结论 + 下一步动作（该充值 / 改模型名 / 换 key）
 *     · 不依赖 VS Code，CI 也能用
 *
 * 用法：
 *   npm run check:api
 *   npm run check:api -- --provider deepseek
 *   npm run check:api -- --provider minimax --model MiniMax-M3
 *
 * ⚠️ 它会真的发一个 max_tokens=1 的请求（几分钱以内）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** provider → 它该用哪把 key（与 src/config.ts、src/eval/cli.ts 同一套规则） */
const PROVIDER_KEY_NAMES = {
  minimax: ['MINIMAX_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  ollama: [],
};
const GENERIC_KEY_NAMES = ['LLM_API_KEY'];

/**
 * provider 默认配置 —— 来自 src/providers.json（唯一真相源）
 *
 *   以前这里硬抄了一份，和插件运行时用的那份各写各的 ——
 *   改一处忘一处 → 自检脚本验 MiniMax、插件打 DeepSeek，且没有任何报错。
 *   现在只保留 JSON 一份。
 */
const PROVIDER_DEFAULTS = require('../src/providers.json');

/** 读项目根 .env（和插件、评测 CLI 同一个文件） */
function readEnvFile() {
  const p = path.join(ROOT, '.env');
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length > 1) ||
      (v.startsWith("'") && v.endsWith("'") && v.length > 1)
    ) {
      v = v.slice(1, -1);
    }
    if (v) out[t.slice(0, i).trim()] = v;
  }
  return out;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--provider' && argv[i + 1]) out.provider = argv[++i];
    else if (argv[i] === '--model' && argv[i + 1]) out.model = argv[++i];
    else if (argv[i] === '--base-url' && argv[i + 1]) out.baseUrl = argv[++i];
  }
  return out;
}

/** 收集所有 key（按 provider 归类） */
function collectKeys(fileEnv) {
  const keys = {};
  let generic;
  const all = { ...fileEnv };
  // 进程环境变量优先级更低，只补 .env 里没有的
  for (const name of [
    'MINIMAX_API_KEY',
    'DEEPSEEK_API_KEY',
    'OPENAI_API_KEY',
    'LLM_API_KEY',
  ]) {
    if (process.env[name] && !all[name]) all[name] = process.env[name];
  }
  for (const [p, names] of Object.entries(PROVIDER_KEY_NAMES)) {
    for (const n of names) {
      if (all[n]) {
        keys[p] = all[n];
        break;
      }
    }
  }
  for (const n of GENERIC_KEY_NAMES) {
    if (all[n]) {
      generic = all[n];
      break;
    }
  }
  return { keys, generic };
}

/** 按 HTTP 状态给出结论 + 下一步动作 */
function verdict(status, text) {
  switch (status) {
    case 401:
      return {
        ok: false,
        title: '❌ key 无效或已被撤销（401）',
        next: '去平台重新复制 key，填进 .env 或插件的「设置 API Key」',
      };
    case 402:
      return {
        ok: false,
        title: '💰 余额不足（402）—— key 是好的！',
        next:
          '去平台「账户钱包 → 充值」；\n' +
          '     或改用「套餐详情」里的订阅 Key（走套餐额度，不按量扣费）\n' +
          '     ⚠️ 平台新建的 API Key 默认是【按量付费】的，\n' +
          '        如果你的账号用的是 M Plan / Credits 资源包，必须换成订阅 Key',
      };
    case 403:
      return {
        ok: false,
        title: '🚫 无权限（403）—— key 是好的，但套餐不包含这个模型',
        next: '去平台确认套餐覆盖的模型名，或换用套餐详情里的订阅 Key',
      };
    case 404:
      return {
        ok: false,
        title: '❓ 模型不存在（404）',
        next: '检查 --model 参数，或用该 provider 的默认模型',
      };
    case 429:
      return { ok: false, title: '⏳ 被限流（429）', next: '等 10 秒再试' };
    default:
      return {
        ok: false,
        title: `⚠ HTTP ${status}`,
        next: '看服务端原文排查',
      };
  }
}

async function main() {
  const args = parseArgs();
  const fileEnv = readEnvFile();
  const { keys, generic } = collectKeys(fileEnv);

  const provider = args.provider || fileEnv.MINI_CODER_PROVIDER || 'deepseek';
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.deepseek;
  const model = args.model || fileEnv.MINI_CODER_MODEL || defaults.defaultModel;
  const baseUrl = args.baseUrl || fileEnv.MINI_CODER_BASE_URL || defaults.baseUrl;

  // ⭐ key 必须和 provider 配套 —— 不拿别的 provider 的 key 顶替
  const key = keys[provider] || generic;

  console.log('\n══ Mini-Coder API 连通性自检 ══\n');
  console.log(`  provider : ${provider}`);
  console.log(`  model    : ${model}`);
  console.log(`  地址     : ${baseUrl}`);
  console.log(
    `  key      : ${
      key
        ? `${key.slice(0, 10)}…（长度 ${key.length}，来自 ${
            keys[provider] ? '.env 里该 provider 专属的 key' : '.env 里的通用 key'
          }）`
        : '（没找到）'
    }`,
  );

  if (!key) {
    console.log('\n❌ 找不到和这个 provider 配套的 API Key。\n');
    console.log(`   请在项目根 .env 里加一行（例如 provider=${provider}）：`);
    console.log(`     ${(PROVIDER_KEY_NAMES[provider] || ['LLM_API_KEY'])[0]}=sk-xxx`);
    console.log('   注意：key 必须和 provider 配套 —— 拿别家的 key 只会得到一个没有信息量的 401。\n');
    process.exit(1);
  }

  if (provider === 'ollama') {
    console.log('\n✅ ollama 是本地模型，不需要 key，跳过探测。\n');
    return;
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
    });

    const text = await resp.text().catch(() => '');

    if (resp.ok) {
      console.log('\n✅ 一切正常：key 有效、余额充足、模型可用。\n');
      return;
    }

    const v = verdict(resp.status, text);
    console.log(`\n${v.title}\n`);
    console.log(`  下一步：${v.next}\n`);
    if (text) console.log(`  服务端原文：${text.slice(0, 300)}\n`);
    process.exit(1);
  } catch (e) {
    console.log(`\n🌐 网络错误：${e && e.message ? e.message : e}\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('自检脚本本身挂了：', e);
  process.exit(1);
});
