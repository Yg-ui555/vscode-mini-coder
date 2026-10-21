/**
 * 评测命令行入口
 *
 * 用法：
 *   npm run eval              跑全部题目
 *   npm run eval -- 03 07     只跑指定序号（1-2 位数字，按 id 前缀匹配）
 *   npm run eval -- --list    列出所有题目，不跑
 *   npm run eval -- --dry     不调真实 LLM（用 mock provider 只验证框架链路）
 *
 * ⚠️ 真实跑批会产生 LLM API 费用。--dry 不花钱但只能验证框架能不能跑。
 */

import './shim'; // ⭐ 必须第一个 import：劫持 require('vscode')
import * as fs from 'fs';
import * as path from 'path';

import { loadAllTasks, TaskMeta, evalRoot } from './types';
import { runTask, EvalConfig, TaskResult } from './runner';
import { summarize, writeReports } from './report';

interface Args {
  filters: string[];
  list: boolean;
  dry: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  return {
    filters: argv.filter((a) => /^\d\d?$/.test(a)),
    list: argv.includes('--list'),
    dry: argv.includes('--dry'),
  };
}

/** 读 .env（跟 ConfigManager 同样的键名，优先用它，方便开发时免填key） */
function loadEnvKey(): { key?: string; provider?: string; model?: string; baseUrl?: string } {
  const envPath = path.join(path.resolve(evalRoot(), '..'), '.env');
  const out: any = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (k === 'MINIMAX_API_KEY' || k === 'DEEPSEEK_API_KEY' || k === 'OPENAI_API_KEY' || k === 'LLM_API_KEY') {
      out.key = v;
    } else if (k === 'MINI_CODER_PROVIDER') out.provider = v;
    else if (k === 'MINI_CODER_MODEL') out.model = v;
    else if (k === 'MINI_CODER_BASE_URL') out.baseUrl = v;
  }
  return out;
}

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  // ⚠️ MiniMax 国内站是 minimaxi.com（末尾多一个 i），国际站是 minimax.io，
  //    两边 key 不通用。国内 key 打到国际站会 401。
  minimax: { baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' },
};

/** dry 模式的假 provider：返回一句文本，不调 API */
async function* dryProviderStream(): AsyncGenerator<any> {
  yield { content: '[dry-run] 未调用真实 LLM，仅验证评测框架链路。' };
  yield {
    isFinal: true,
    finalResponse: { content: '[dry-run]', toolCalls: [], finishReason: 'stop' },
  };
}

async function main() {
  const args = parseArgs();
  let tasks: TaskMeta[] = loadAllTasks();

  if (args.filters.length > 0) {
    tasks = tasks.filter((t) => args.filters.some((f) => t.id.startsWith(f)));
  }

  console.log(`\n🧪 Mini-Coder 评测 —共 ${tasks.length} 题\n`);

  if (args.list) {
    for (const t of tasks) {
      console.log(`  ${t.id.padEnd(24)} [${t.tier.padEnd(11)}] ${t.title}`);
    }
    console.log('');
    return;
  }

  if (tasks.length === 0) {
    console.log('⚠ 没有可跑的题目。先在 eval/tasks/ 下建题目。\n');
    return;
  }

  const env = loadEnvKey();
  const providerName = env.provider || 'deepseek';
  const defaults = PROVIDER_DEFAULTS[providerName] || PROVIDER_DEFAULTS.deepseek;

  const config: EvalConfig = {
    provider: providerName,
    apiKey: env.key || '',
    baseUrl: env.baseUrl || defaults.baseUrl,
    model: env.model || defaults.model,
    maxIterations: 20,
    timeoutMs: 180_000,
    approvalMode: 'auto', // 评测里不让弹窗打断
  };

  if (!args.dry && !config.apiKey) {
    console.error('❌ 找不到 API Key。');
    console.error('   在项目根 .env 里加一行，例如：');
    console.error('     MINIMAX_API_KEY=sk-xxx');
    console.error('     MINI_CODER_PROVIDER=minimax');
    console.error('     MINI_CODER_MODEL=MiniMax-M3');
    console.error('   或者先跑 `npm run eval -- --dry` 验证框架（不花钱）。\n');
    process.exit(1);
  }

  const startedAt = Date.now();
  const results: TaskResult[] = [];

  for (const task of tasks) {
    process.stdout.write(`▶ ${task.id.padEnd(24)} ${task.title.slice(0, 30).padEnd(32)}`);
    try {
      const result = args.dry
        ? await runDryTask(task, config)
        : await runTask(task, config);

      results.push(result);

      const icon =
        result.verdict === 'pass'
          ? '✅ pass'
          : result.verdict === 'regressed'
            ? `⚠️ regressed(${result.regressions.length})`
            : result.verdict === 'error'
              ? '🔧 error'
              : '❌ fail';
      // ⭐ 每题后面直接跟成本：跑到一半就能看出"这题贵不贵"，
      //   不用等全部跑完才在报告里翻。
      const cost = result.cost
        ? `¥${result.cost.cost.toFixed(4)} ${result.llmCalls ?? 0}轮`
        : '';
      console.log(icon.padEnd(22) + `${(result.durationMs / 1000).toFixed(1)}s`.padEnd(9) + cost);
      if (result.error) console.log(`    ↳ ${result.error.split('\n')[0]}`);
    } catch (e: any) {
      console.log(`🔧 error  ${e?.message || e}`);
      results.push({
        id: task.id, tier: task.tier, title: task.title, verdict: 'error',
        fixedCases: [], regressions: [], stillFailing: [], cases: [],
        toolTrace: [], changedFiles: [], finalAnswer: '', durationMs: 0,
        error: String(e?.stack || e),
      });
    }
  }

  const summary = summarize(results, {
    model: config.model,
    provider: config.provider,
    durationMs: Date.now() - startedAt,
  });
  const { md, json } = writeReports(summary);

  console.log('\n' + '─'.repeat(58));
  console.log(`Pass Rate: ${summary.passRate}%  (${summary.pass}/${summary.total})`);
  console.log(`  未达成 ${summary.fail} | 回归 ${summary.regressed} | 错误 ${summary.error}`);
  if (args.dry) {
    console.log('  成本：--dry 未调真实 LLM，token 恒为 0（这不代表免费）');
  } else {
    console.log(
      `  成本：${summary.totalUsage.totalTokens.toLocaleString('en-US')} tok · ¥${summary.totalCost.toFixed(4)}` +
        (summary.priceKnown ? '' : ' ⚠️模型不在价目表，按默认价估算'),
    );
    if (summary.pass > 0) {
      console.log(`  每通过一题：¥${summary.costPerPass.toFixed(4)}`);
    }
  }
  console.log('─'.repeat(58) + '\n');
  console.log(`📄 报告：${md}`);
  console.log(`📊 原始数据：${json}\n`);
}

/** dry 模式：跑完整流程但用假 provider（不花钱，验证框架） */
async function runDryTask(task: TaskMeta, config: EvalConfig): Promise<TaskResult> {
  // 偷懒但有效的做法：临时把 provider 换成 mock
  const { OpenAIProvider: RealProvider } = require('../agent/provider');
  const fake = {
    stream: async function* () {
      yield* dryProviderStream();
    },
  };

  // 直接复用 runner，但通过 setPrototypeOf 替换 stream
  const orig = RealProvider.prototype.stream;
  RealProvider.prototype.stream = fake.stream;
  try {
    return await runTask(task, { ...config, approvalMode: 'auto' });
  } finally {
    RealProvider.prototype.stream = orig;
  }
}

main().catch((e) => {
  console.error('评测跑挂了：', e);
  process.exit(1);
});