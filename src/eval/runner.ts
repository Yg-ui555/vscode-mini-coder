/**
 * 单题执行器：沙箱隔离 → baseline → 跑 agent → 复检 → L4 回归比对
 *
 * 流程（这一步顺序不能乱）：
 *   1. 把 initial/ 复制到独立沙箱（题与题之间零污染）
 *   2. 跑一次 check.js 记为【baseline】
 *      —— 这一步是为了 L4：知道"哪些 case 本来就是过的"
 *   3. 让 agent 在沙箱里干活
 *   4. 再跑一次 check.js 记为【after】
 *   5. 三方比对：
 *        baseline 过 + after 过   → 保持通过
 *        baseline 挂 + after 过   → 修好了（这才是这题要的）
 *        baseline 挂 + after 挂   → 没修好
 *        baseline 过 + after 挂   → ⭐ 回归！agent 把好的改坏了
 *
 * L4 回归是这套评测里最有价值的部分：
 *   AI 编程助手最典型的失败不是"没改对"，而是"改对了目标、把别处改坏了"，
 *   而这个 bug agent 自己发现不了——它跑一次测试看到绿色就收工了。
 *   只统计"最终有没有过"的话，这类失败会被完全掩盖。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { OpenAIProvider, TokenUsage } from '../agent/provider';
import { AgentLoop } from '../agent/loop';
import { ToolRegistry } from '../agent/tools/registry';
import { createDefaultRegistry } from '../agent/tools/factory';
import { ContextBuilder } from '../agent/context';
import { setWorkspaceRoot } from '../agent/tools/paths';
import { setNonInteractive } from '../agent/tools/approval';
import { setEvalWorkspace } from './shim';
import { setCheckpointEnabled } from '../agent/checkpoint/store';
import { setToolOutputEnabled } from '../agent/toolOutputStore';
import { setNotesRoot } from '../util/notesStore';
import { addUsage, emptyUsage, estimateCost, CostBreakdown } from '../util/cost';

import {
  TaskMeta,
  CheckModule,
  CheckContext,
  ToolTrace,
  loadCheck,
  copyDir,
  listFiles,
} from './types';

export interface CaseResult {
  name: string;
  baseline: boolean;
  after: boolean;
  error?: string;
}

export type TaskVerdict =
  | 'pass' // 目标达成
  | 'fail' // 没达成
  | 'regressed' // 达成目标但弄坏了原本好的（算失败，且更严重）
  | 'error'; // 评测基础设施出错，跟 agent 无关

export interface TaskResult {
  id: string;
  tier: string;
  title: string;
  verdict: TaskVerdict;
  /** 本题要求修复/实现的 case：baseline 挂 → after 过 = 达成 */
  fixedCases: string[];
  /** 回归：baseline 过 → after 挂 */
  regressions: string[];
  /** 一直没过的（跟本题目标无关的坏 case，可忽略） */
  stillFailing: string[];
  cases: CaseResult[];
  toolTrace: ToolTrace[];
  changedFiles: string[];
  finalAnswer: string;
  durationMs: number;
  /** ⭐ 本题 token 开销（provider 返回的真实用量，不是估算字符数） */
  usage?: TokenUsage;
  /** ⭐ 本题估算成本。priceKnown=false 表示模型不在价目表里，用的是保守默认值 */
  cost?: CostBreakdown;
  /** ⭐ LLM 调用轮数 = 工具调用轮数 + 1（最后一轮出结论） */
  llmCalls?: number;
  error?: string;
}

export interface EvalConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  maxIterations: number;
  /** 单题超时（毫秒） */
  timeoutMs: number;
  /**
   * 评测是非交互环境，写操作一律自动放行（不能弹窗打断跑批）
   *
   * ⚠️ 这不是把权限全开了：路径白名单、checkpoint 开关这些边界在评测里照常生效，
   *   自动放行的只是「问不问用户」这一层。真要测权限行为得另开专门机制。
   */
  nonInteractive: boolean;
  /**
   * ⭐ 消融：把哪些工具摘掉
   *
   * 用来验证"这道题到底在测什么"。
   * 摘掉的工具不会出现在给 LLM 的 schema 里 —— LLM 连它存在都不知道。
   */
  ablateTools?: string[];
}

/**
 * 清理沙箱内的 require 缓存
 *
 * ⚠️ 为什么必须清：check.js 里用 require(path.join(dir, 'x.js')) 读代码，
 *   Node 会缓存模块。第一次（baseline）读到初始代码，agent 改完文件后，
 *   第二次（after）如果不清缓存，还是读到旧内容 —— 那样 after 永远等于 baseline，
 *   整套评测直接失效。
 *
 * ⚠️ Windows 注意：require.cache 的 key 是 require 传进来的原始字符串，
 *   大小写和分隔符可能跟 ctx.dir 不一致（比如 C:\Users vs c:\users），
 *   所以要规范化 + 忽略大小写比较，否则会漏清。
 */
export function clearSandboxCache(dir: string): void {
  const normalized = path.resolve(dir).replace(/[\\/]+$/, '').toLowerCase();
  for (const key of Object.keys(require.cache)) {
    const k = path.resolve(key).replace(/[\\/]+$/, '').toLowerCase();
    if (k.startsWith(normalized)) delete require.cache[key];
  }
}

/** 跑一遍 check，返回每个 case 的通过情况 */
async function runCheck(
  check: CheckModule,
  ctx: CheckContext,
): Promise<Array<{ name: string; ok: boolean; error?: string }>> {
  const results: Array<{ name: string; ok: boolean; error?: string }> = [];
  // 清掉沙箱内模块缓存，保证每次都读改后的代码
  clearSandboxCache(ctx.dir);

  for (const c of check.cases) {
    try {
      await c.fn(ctx);
      results.push({ name: c.name, ok: true });
    } catch (e: any) {
      results.push({ name: c.name, ok: false, error: e?.message || String(e) });
    }
  }
  return results;
}

/**
 * 工具参数摘要
 *
 * ⭐ 为什么要摘要而不是原样存：
 *   apply_patch 的参数里可能是一整段上千行的 diff，
 *   原样存进 results.json 会让文件大到没法看。
 *
 * ⭐ 为什么要存（之前是空对象）：
 *   消融实验暴露出来的真实问题 ——
 *   轨迹里只有"调了 35 次 run_shell"，没有参数，
 *   就没法判断它跑的是 `ls` 还是 `grep`：
 *   前者说明 grep 这个【工具】确实可以省，
 *   后者说明消融漏了（agent 绕道 shell 又把 grep 用上了）。
 *   这两种结论完全相反，不能靠猜。
 */
function summarizeArgs(args: any): any {
  if (!args || typeof args !== 'object') return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string') {
      out[k] = v.length > 300 ? `${v.slice(0, 300)}…（共 ${v.length} 字符）` : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** 跑一道题 */
export async function runTask(task: TaskMeta, config: EvalConfig): Promise<TaskResult> {
  const startedAt = Date.now();
  const sandbox = path.join(os.tmpdir(), `minicoder-eval-${task.id}-${Date.now()}`);
  // ⭐ 错题本的落盘位置（沙箱外，理由见下面 setNotesRoot 那段注释）
  const notesRoot = path.join(os.tmpdir(), `minicoder-eval-notes-${task.id}-${Date.now()}`);

  const base: TaskResult = {
    id: task.id,
    tier: task.tier,
    title: task.title,
    verdict: 'error',
    fixedCases: [],
    regressions: [],
    stillFailing: [],
    cases: [],
    toolTrace: [],
    changedFiles: [],
    finalAnswer: '',
    durationMs: 0,
    usage: emptyUsage(),
    llmCalls: 0,
  };

  // ⭐ 累计本次任务的真实 token 用量。
  //   onTokenUsage 给的 total 是【本次 run 的累计】而不是全局，
  //   所以每题开一个独立的累加器，不会串味。
  //   声明放在 try 外面：万一中途抛错，已经烧掉的 token 也要记进报告，
  //   不然"跑崩了"看起来就像"没花钱"，那才是真正的骗人。
  const tokenTotal = emptyUsage();
  let llmCalls = 0;

  try {
    // 1. 沙箱
    if (fs.existsSync(sandbox)) fs.rmSync(sandbox, { recursive: true, force: true });
    if (fs.existsSync(task.initialDir)) copyDir(task.initialDir, sandbox);
    else fs.mkdirSync(sandbox, { recursive: true });

    const filesBefore = listFiles(sandbox);

    // 让工具层认为沙箱就是工作区（路径白名单才会放行题目目录）
    setWorkspaceRoot(sandbox);
    setEvalWorkspace(sandbox);
    setNonInteractive(config.nonInteractive);
    // ⭐ 沙箱里关掉 checkpoint：它会在 sandbox 下造出 .mini-coder/ 目录，
    //    而 eval/types.ts 的 listFiles() 不忽略任何目录，会把这些存档
    //    算进"agent 改了哪些文件"，污染 L4 回归检测的证据链。
    setCheckpointEnabled(false);
    // ⭐ 同理关掉大输出外置（理由完全一致，它也写在 .mini-coder/ 下）
    //
    //   补充一条更本质的理由：评测的成本统计来自 provider 上报的
    //   真实 usage，不是本地估算。沙箱里外置省的是"估算出来的 token"，
    //   对真实账单毫无影响 —— 反而让 agent 多绕一圈去 read_file，
    //   把评测搞复杂、结果搞失真。
    //
    //   想验证外置的真实收益，要在真实 VS Code 里看面板上的 token 用量，
    //   不要拿评测的数字当证据。
    setToolOutputEnabled(false);

    // ⭐⭐ 错题本也写到【沙箱外】—— 2026-10-25 补上的漏网之鱼
    //
    //   理由和上面两个【完全一样】：错题本会在工作区下造出 .notes/ 目录，
    //   listFiles() 会把它算成"agent 改了哪些文件"，污染 L4 回归检测。
    //
    //   实测踩到的坑：26 号对抗题有一条"仓库文件集合不许变"的守卫，
    //   agent 顺手记了条错题本就把守卫干掉了 —— 而任务级判定还显示"通过"
    //   （那条守卫在 baseline 也是挂的，失败原因被掩盖了）。
    //   一次真实的越界行为差点从报告里消失。
    setNotesRoot(notesRoot);

    const check = loadCheck(task);

    const makeCtx = (finalAnswer: string, toolTrace: ToolTrace[]): CheckContext => ({
      dir: sandbox,
      finalAnswer,
      transcript: toolTrace,
      task,
    });

    // 2. baseline
    const baseline = await runCheck(check, makeCtx('', []));

    // 3. 跑 agent
    const toolTrace: ToolTrace[] = [];
    const provider = new OpenAIProvider(config.baseUrl, config.apiKey, config.model);

    // ⭐ 评测沙箱必须和真实用户拿到【完全一样】的工具集
    //   否则评测出来的 pass rate 是失真的：题目做不出来可能只是因为
    //   沙箱里少了 grep，而不是模型不会。
    //
    //   ⚠️ 消融模式是唯一的例外 —— 那是有意为之的对照实验，
    //   目的是回答"这题到底在测什么"，不是测真实能力。
    const registry = createDefaultRegistry({ exclude: config.ablateTools });

    const loop = new AgentLoop(provider, registry, config.maxIterations, config.model);

    const messages: any[] = [
      { role: 'system', content: new ContextBuilder(sandbox).buildSystemPrompt() },
      { role: 'user', content: task.prompt },
    ];

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), config.timeoutMs);

    let finalAnswer = '';
    try {
      finalAnswer = await loop.run(messages, abort.signal, {
        onText: () => {},
        onToolCall: () => {},
        onToolResult: (name, result, args) => {
          toolTrace.push({
            tool: name,
            args: summarizeArgs(args),
            isError: !!result.isError,
            preview: result.content.slice(0, 200),
          });
        },
        onTokenUsage: (delta, _total) => {
          const summed = addUsage(tokenTotal, delta);
          tokenTotal.promptTokens = summed.promptTokens;
          tokenTotal.completionTokens = summed.completionTokens;
          tokenTotal.totalTokens = summed.totalTokens;
          llmCalls++;
        },
      });
    } finally {
      clearTimeout(timer);
      abort.abort();
    }

    // 4. after
    const after = await runCheck(check, makeCtx(finalAnswer, toolTrace));

    // 5. 三方比对
    const cases: CaseResult[] = [];
    const regressions: string[] = [];
    const fixed: string[] = [];
    const stillFailing: string[] = [];

    for (let i = 0; i < check.cases.length; i++) {
      const name = check.cases[i].name;
      const b = baseline[i]?.ok ?? false;
      const a = after[i]?.ok ?? false;
      cases.push({ name, baseline: b, after: a, error: after[i]?.error });

      if (b && a) continue; // 一直通过
      if (!b && a) {
        fixed.push(name); // 修好了
        continue;
      }
      if (b && !a) {
        regressions.push(name); // ⭐ 回归
        continue;
      }
      stillFailing.push(name); // 一直没好
    }

    // 改了哪些文件 —— 存一份 baseline 快照来做真实的增删改判定
    const filesAfter = listFiles(sandbox);
    const beforeSet = new Set(filesBefore);
    const afterSet = new Set(filesAfter);
    const changed: string[] = [];
    for (const f of filesAfter) {
      if (!beforeSet.has(f)) {
        changed.push(`新 ${f}`);
        continue;
      }
      // 同名文件：内容有变化就是"改"
      try {
        const now = fs.readFileSync(path.join(sandbox, f), 'utf-8');
        const before = fs.readFileSync(path.join(task.initialDir, f), 'utf-8');
        if (now !== before) changed.push(`改 ${f}`);
      } catch {}
    }
    for (const f of filesBefore) {
      if (!afterSet.has(f)) changed.push(`删 ${f}`);
    }

    // 判定
    let verdict: TaskVerdict;
    if (fixed.length === 0) verdict = 'fail';
    else if (regressions.length > 0) verdict = 'regressed';
    else verdict = 'pass';

    return {
      ...base,
      verdict,
      fixedCases: fixed,
      regressions,
      stillFailing,
      cases,
      toolTrace,
      changedFiles: changed,
      finalAnswer: finalAnswer.slice(0, 2000),
      durationMs: Date.now() - startedAt,
      usage: { ...tokenTotal },
      cost: estimateCost(tokenTotal, config.model),
      llmCalls,
    };
  } catch (e: any) {
    return {
      ...base,
      error: e?.stack || e?.message || String(e),
      durationMs: Date.now() - startedAt,
      usage: { ...tokenTotal },
      cost: estimateCost(tokenTotal, config.model),
      llmCalls,
    };
  } finally {
    // 清理沙箱
    try {
      fs.rmSync(sandbox, { recursive: true, force: true });
    } catch {}
    // ⭐ 错题本也在沙箱外，一并清掉
    try {
      fs.rmSync(notesRoot, { recursive: true, force: true });
    } catch {}
    setWorkspaceRoot(undefined);
    setEvalWorkspace(undefined);
    setCheckpointEnabled(true);
    setToolOutputEnabled(true);
    setNotesRoot(undefined);
  }
}