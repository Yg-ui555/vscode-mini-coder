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
import { summarize, writeReports, ReportVariant } from './report';
import {
  summarizeRuns,
  summarizeSuite,
  TaskStatistics,
} from './statistics';

interface Args {
  filters: string[];
  list: boolean;
  dry: boolean;
  /**
   * ⭐ 重复运行次数（2026-10-24）
   *
   *   为什么需要：
   *     实测发现单次运行的噪声极大 ——
   *     同一份代码，同一批题，单次 token 能从 -67% 波动到 +233%。
   *     这时候单次对比得出的结论，很可能是噪声而不是真实差异。
   *
   *   用法：
   *     npm run eval -- --repeat 3        每题跑 3 次，输出方差统计
   *     npm run eval -- --repeat 3 13 21  只把这几题跑 3 次
   *
   *   成本提醒：--repeat N 会让成本变成 N 倍。
   */
  repeat: number;
  /**
   * ⭐ 消融：把哪些工具摘掉
   *
   * 目的：pass rate 打到 100% 之后，"这题到底在测什么"需要证据。
   *   把 grep 摘掉，如果某几题立刻挂 —— 就说明这些题确实在测
   *   "会不会用搜索工具把影响面找全"，而不是送分题。
   *
   * 用法：npm run eval -- --ablate grep
   *        npm run eval -- --ablate grep,glob 31 32
   */
  ablateTools: string[];
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);

  // 解析 --repeat N（也支持 --repeat=N）
  let repeat = 1;
  const repeatIdx = argv.indexOf('--repeat');
  if (repeatIdx >= 0) {
    const v = Number(argv[repeatIdx + 1]);
    if (Number.isFinite(v) && v >= 1) repeat = Math.floor(v);
  }
  const repeatEq = argv.find((a) => a.startsWith('--repeat='));
  if (repeatEq) {
    const v = Number(repeatEq.split('=')[1]);
    if (Number.isFinite(v) && v >= 1) repeat = Math.floor(v);
  }

  return {
    filters: argv.filter((a) => /^\d\d?$/.test(a)),
    list: argv.includes('--list'),
    dry: argv.includes('--dry'),
    repeat,
    ablateTools: parseAblate(argv),
  };
}

/** 解析 --ablate a,b,c */
function parseAblate(argv: string[]): string[] {
  const out: string[] = [];
  const eq = argv.find((a) => a.startsWith('--ablate='));
  if (eq) {
    out.push(...eq.slice('--ablate='.length).split(',').map((s) => s.trim()).filter(Boolean));
  }
  const idx = argv.indexOf('--ablate');
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('-')) {
    out.push(...argv[idx + 1].split(',').map((s) => s.trim()).filter(Boolean));
  }
  return [...new Set(out)];
}

/** .env / 环境变量里可能出现的 key 名 */
const API_KEY_NAMES = ['MINIMAX_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'LLM_API_KEY'];

/**
 * provider → 它该用哪把 key（跟 src/config.ts 保持同一套规则）
 *
 * ⚠️ 为什么必须按 provider 归类（2026-10-29）：
 *   .env 里同时放 MiniMax 和 DeepSeek 两把 key 时，"谁在后面谁赢"会让评测
 *   拿 MiniMax 的 key 去打 DeepSeek —— 服务端只回一个 401，
 *   报错里绝不会告诉你"你拿错那把钥匙了"。
 */
const PROVIDER_KEY_NAMES: Record<string, string[]> = {
  minimax: ['MINIMAX_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  ollama: [],
};

/** 不挑 provider 的通用 key */
const GENERIC_KEY_NAMES = ['LLM_API_KEY'];

interface EnvBundle {
  /** provider → key */
  keys: Record<string, string>;
  genericKey?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
}

/**
 * 读 API Key / Provider 配置
 *
 * ⭐ 优先级：进程环境变量 < 项目根 .env
 *
 *   为什么必须支持进程环境变量（2026-10-28 修 CI 红）：
 *     GitHub Actions 的 secret、`docker -e`、`export KEY=...` 全是走环境变量的。
 *     之前这里【只】读 .env 文件 —— 于是 CI 里 secret 明明注进去了
 *     （日志里 env 一栏清清楚楚写着 DEEPSEEK_API_KEY: ***），
 *     评测却报"❌ 找不到 API Key"，白烧一次 CI。
 *
 *   .env 排在前面：它是开发者本地显式写的，应该赢过环境变量。
 */
function loadEnv(): EnvBundle {
  const out: EnvBundle = { keys: {} };

  // ── 先读进程环境变量（CI 的 secret 走这条路）──
  const envKeyName = API_KEY_NAMES.find((n) => process.env[n]);
  if (envKeyName) {
    const v = process.env[envKeyName] as string;
    const p = Object.keys(PROVIDER_KEY_NAMES).find((k) =>
      PROVIDER_KEY_NAMES[k].includes(envKeyName),
    );
    if (p) out.keys[p] = v;
    else out.genericKey = v;
  }
  if (process.env.MINI_CODER_PROVIDER) out.provider = process.env.MINI_CODER_PROVIDER;
  if (process.env.MINI_CODER_MODEL) out.model = process.env.MINI_CODER_MODEL;
  if (process.env.MINI_CODER_BASE_URL) out.baseUrl = process.env.MINI_CODER_BASE_URL;

  // ── 再读项目根 .env（⭐ 它覆盖环境变量）──
  //   理由同上：.env 是开发者本地显式写的，应该赢过环境变量。
  //   所以这一段是【赋值】而不是【补空】。
  const envPath = path.join(path.resolve(evalRoot(), '..'), '.env');
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    const p = Object.keys(PROVIDER_KEY_NAMES).find((pk) => PROVIDER_KEY_NAMES[pk].includes(k));
    if (p) out.keys[p] = v;
    else if (GENERIC_KEY_NAMES.includes(k)) out.genericKey = v;
    else if (k === 'MINI_CODER_PROVIDER') out.provider = v;
    else if (k === 'MINI_CODER_MODEL') out.model = v;
    else if (k === 'MINI_CODER_BASE_URL') out.baseUrl = v;
  }
  return out;
}

/**
 * 取【与这个 provider 配套】的那把 key
 *
 * 刻意【不】回退到别的 provider 的 key：
 *   拿错 key 只会得到一个没有信息量的 401，
 *   而"没找到 key"是一句用户看得懂的话。
 */
function pickKey(env: EnvBundle, provider: string): string | undefined {
  return env.keys[provider] || env.genericKey;
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

  const env = loadEnv();
  const providerName = env.provider || 'deepseek';
  const defaults = PROVIDER_DEFAULTS[providerName] || PROVIDER_DEFAULTS.deepseek;

  const config: EvalConfig = {
    provider: providerName,
    // ⭐ key 必须和 provider 配套（2026-10-29）
    apiKey: pickKey(env, providerName) || '',
    baseUrl: env.baseUrl || defaults.baseUrl,
    model: env.model || defaults.model,
    maxIterations: 20,
    timeoutMs: 180_000,
    nonInteractive: true, // 评测里不让弹窗打断
    ablateTools: args.ablateTools,
  };

  if (args.ablateTools.length > 0) {
    console.log('');
    console.log('🧪 消融模式：本次摘掉了这些工具 ——');
    for (const t of args.ablateTools) console.log(`     · ${t}`);
    console.log('   （LLM 的工具清单里【没有】它们，它连这些工具存在都不知道）');
    console.log('   ⚠️ 这是对照实验，跑出来的数字不代表真实能力，只用来回答"这题在测什么"');

    // ⭐⭐ 消融的【漏洞】：run_shell 是个后门
    //
    //   实测踩到的坑：摘掉 grep 这个【工具】之后，
    //   agent 转头就用 run_shell 跑了 `grep -rn ...` ——
    //   能力一点没少，只是绕了个弯。
    //
    //   所以"消融某个 CLI 工具"必须是【严格的】：
    //   还得把 run_shell 一起摘掉，否则测的是" ergonomics"而不是"能力"。
    const leaky = args.ablateTools.filter((t) => t !== 'run_shell');
    if (leaky.length > 0 && !args.ablateTools.includes('run_shell')) {
      console.log('');
      console.log('   ⚠️⚠️ 消融不彻底：run_shell 还在，agent 可以用 shell 直接调这些 CLI 工具');
      console.log('        （实测：摘掉 grep 之后，agent 转头就跑了 `grep -rn ...`）');
      console.log('        要做严格消融请加上 run_shell：--ablate ' + [...leaky, 'run_shell'].join(','));
    }
    console.log('');
  }

  if (!args.dry && !config.apiKey) {
    console.error('❌ 找不到 API Key。');
    console.error(`   当前 provider 是「${providerName}」，需要它对应的那把 key。`);
    console.error('   在项目根 .env 里加一行，例如：');
    console.error('     MINIMAX_API_KEY=sk-xxx   （provider=minimax 时）');
    console.error('     DEEPSEEK_API_KEY=sk-xxx  （provider=deepseek 时）');
    console.error('   或者先跑 `npm run eval -- --dry` 验证框架（不花钱）。\n');
    process.exit(1);
  }

  const startedAt = Date.now();
  const results: TaskResult[] = [];

  // ⭐ 重复运行时，每题的多次结果分开存（用于方差统计）
  const perTaskRuns = new Map<string, TaskResult[]>();

  for (const task of tasks) {
    const taskRuns: TaskResult[] = [];

    for (let run = 1; run <= args.repeat; run++) {
      const runLabel = args.repeat > 1 ? ` (第${run}/${args.repeat}次)` : '';
      process.stdout.write(
        `▶ ${task.id.padEnd(24)} ${task.title.slice(0, 30).padEnd(32)}${runLabel}`,
      );
      try {
        const result = args.dry
          ? await runDryTask(task, config)
          : await runTask(task, config);

        taskRuns.push(result);
        results.push(result);

        const icon =
          result.verdict === 'pass'
            ? '✅ pass'
            : result.verdict === 'regressed'
              ? `⚠️ regressed(${result.regressions.length})`
              : result.verdict === 'error'
                ? `🔧 error`
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
        const errResult: TaskResult = {
          id: task.id, tier: task.tier, title: task.title, verdict: 'error',
          fixedCases: [], regressions: [], stillFailing: [], cases: [],
          toolTrace: [], changedFiles: [], finalAnswer: '', durationMs: 0,
          error: String(e?.stack || e),
        };
        taskRuns.push(errResult);
        results.push(errResult);
      }
    }

    perTaskRuns.set(task.id, taskRuns);
  }

  const summary = summarize(results, {
    model: config.model,
    provider: config.provider,
    durationMs: Date.now() - startedAt,
    ablatedTools: args.ablateTools,
  });
  // ⭐ 报告分流：只有「全量 + 真实 LLM」的跑批才允许覆盖正式基线报告。
  //
  //   理由见 src/eval/report.ts 里 ReportVariant 的注释：
  //   一条 `npm run eval:dry` 或 `node out/eval/cli.js 01 23`（2 题冒烟）
  //   就能把对外展示的 93% 基线冲成 3%，而 dry 模式压根没调 LLM。
  //
  //   消融实验同理：它【故意】阉掉工具，pass rate 必然更低，
  //   让它覆盖基线就是在制造"能力退化"的假象。
  const variant: ReportVariant = args.dry
    ? 'dry'
    : args.ablateTools.length > 0
      ? 'ablation'
      : args.filters.length > 0
        ? 'partial'
        : 'full';
  const { md, json } = writeReports(summary, variant);

  console.log('\n' + '─'.repeat(58));
  console.log(`Pass Rate: ${summary.passRate}%  (${summary.pass}/${summary.total})`);
  console.log(`  未达成 ${summary.fail} | 回归 ${summary.regressed} | 错误 ${summary.error}`);
  console.log(
    `  目标 case 修好：${summary.targetCases.fixed}/${summary.targetCases.total}` +
      `（${summary.targetCases.rate}%）  ← 比任务级 pass rate 更细一档的信号`,
  );
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

  // ⭐ 重复运行时输出方差报告（2026-10-24）
  if (args.repeat > 1) {
    printVarianceReport(perTaskRuns);
  }

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
    return await runTask(task, { ...config, nonInteractive: true });
  } finally {
    RealProvider.prototype.stream = orig;
  }
}


/**
 * ⭐ 打印方差报告（2026-10-24）
 *
 * 目的：让"这个改动到底有没有效"变成一个【可判定】的问题。
 *
 * 类比：
 *   想知道新代码快不快，先得知道这台机器的跑分能差多少。
 *   差异大于噪声 → 是真改进；差异小于噪声 → 是运气。
 */
function printVarianceReport(perTaskRuns: Map<string, TaskResult[]>): void {
  const stats: TaskStatistics[] = [];
  for (const [taskId, runs] of perTaskRuns) {
    if (runs.length === 0) continue;
    stats.push(summarizeRuns(taskId, runs[0].tier, runs[0].title, runs));
  }

  const suite = summarizeSuite(stats);

  console.log('📊 方差报告（每题跑多次）');
  console.log('─'.repeat(78));
  console.log(
    `  ${'题目'.padEnd(30)} ${'通过率'.padStart(8)} ${'token 均值'.padStart(12)} ` +
      `${'标准差'.padStart(10)} ${'cv'.padStart(8)} ${'波动'.padStart(6)}`,
  );

  for (const s of suite.perTask) {
    const idPadded = s.taskId.length > 29 ? s.taskId.slice(0, 29) : s.taskId;
    console.log(
      `  ${idPadded.padEnd(30)} ` +
        `${(s.passRate.toFixed(0) + '%').padStart(8)} ` +
        `${s.meanTokens.toLocaleString('en-US').padStart(12)} ` +
        `${s.stddevTokens.toLocaleString('en-US').padStart(10)} ` +
        `${(s.cvTokens * 100).toFixed(1).padStart(7)}% ` +
        `${(s.highVariance ? '⚠️大' : '正常').padStart(6)}`,
    );
  }

  console.log('─'.repeat(78));
  console.log(`  整体 token 变异系数：${(suite.suiteCvTokens * 100).toFixed(1)}%`);
  console.log(`  波动大的题：${suite.highVarianceCount} / ${suite.perTask.length}`);
  console.log(
    `  ⭐ 解读：cv > 15% 的题，单次对比得出的差异【不可信】——\n` +
      `     必须跑多次看分布。这也是为什么"某题 token 涨了 233%"不能直接当结论。`,
  );
  console.log('');
}

main().catch((e) => {
  console.error('评测跑挂了：', e);
  process.exit(1);
});