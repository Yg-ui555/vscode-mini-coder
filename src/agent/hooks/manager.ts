/**
 * Hook 调度器
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 它是干什么的
 *
 * 把"配置"翻译成"对 agent 循环的实际影响"：
 *   · 该跑哪几个 hook（matcher 过滤）
 *   · 跑完之后【阻断】还是【放行】
 *   · 出问题的时候【记日志】还是【崩掉】（答案永远是后者不发生）
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 为什么用模块级单例
 *
 * AgentLoop 在 4 个地方被 new（面板 / 评测 / AI 修测试 / 未来更多），
 * 每个构造点都传一个 hookManager 进去太啰嗦，而且漏一个就静默失效 ——
 * 这跟 factory.ts 当初解决的是同一类问题。
 *
 * 单例 + 按工作区根自动重载，跟 repeatGuard.ts 的 resetGuard() 一个套路。
 */

import * as fs from 'fs';

import { getDefaultCwd } from '../tools/paths';
import { info, warn } from '../../logger';
import { runHookCommand } from './runner';
import { entriesFor, entryMatches, loadHooksConfig, LoadedHooks } from './config';
import {
  HookEvent,
  HookInvocation,
  HookOutcome,
  HooksFile,
  MAX_STOP_BLOCKS,
} from './types';

/** 内置的 Stop 检查（比如"测试没过就不许收工"） */
export type BuiltinStopCheck = (
  cwd: string,
) => Promise<{ ok: boolean; message: string }>;

let builtinStopCheck: BuiltinStopCheck | undefined;

/**
 * 注册内置的 Stop 检查
 *
 * ⚠️ 用【注册】而不是【直接 import】是有意的：
 *   autoTest.ts 会 import AgentLoop，而 AgentLoop 又要用 hook ——
 *   直接 import 就成了循环依赖。
 *   注册制把依赖方向掰成单向：extension.ts 同时认识两边。
 */
export function setBuiltinStopCheck(fn: BuiltinStopCheck | undefined): void {
  builtinStopCheck = fn;
}

export class HookManager {
  readonly root: string;

  private loaded: LoadedHooks;

  /** 配置文件的修改时间 —— 变了就重载（用户改完 hooks.json 立刻生效） */
  private configMtimeMs = 0;

  /** Stop 连续阻断次数 */
  private stopBlocks = 0;

  constructor(root: string, loaded?: LoadedHooks) {
    this.root = root;
    this.loaded = loaded ?? loadHooksConfig(root);
    this.configMtimeMs = this.currentMtime();
  }

  /** 从磁盘加载（构造时用） */
  static load(root: string): HookManager {
    const loaded = loadHooksConfig(root);
    const m = new HookManager(root, loaded);
    for (const p of loaded.problems) {
      warn(`[hook] ${p}`);
    }
    return m;
  }

  get configPath(): string | null {
    return this.loaded.path;
  }

  /** 当前生效的配置（只读） */
  get config(): HooksFile {
    return this.loaded.config;
  }

  get problems(): string[] {
    return this.loaded.problems;
  }

  /** 有没有任何 hook（含内置的） */
  get hasHooks(): boolean {
    return this.hasUserHooks || builtinStopCheck !== undefined;
  }

  private get hasUserHooks(): boolean {
    for (const e of Object.values(this.loaded.config.hooks ?? {})) {
      if (e && e.length > 0) return true;
    }
    return false;
  }

  /** 配置改了没？ */
  private currentMtime(): number {
    const p = this.loaded.path;
    if (!p) return 0;
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      return 0;
    }
  }

  /** 配置变了就重新读一遍 */
  private refreshIfChanged(): void {
    const p = this.loaded.path;
    if (!p) {
      // 之前没有配置文件 —— 用户可能刚建了一个
      const fresh = loadHooksConfig(this.root);
      if (fresh.path) {
        this.loaded = fresh;
        this.configMtimeMs = this.currentMtime();
      }
      return;
    }
    const m = this.currentMtime();
    if (m !== this.configMtimeMs) {
      this.loaded = loadHooksConfig(this.root);
      this.configMtimeMs = this.currentMtime();
      info(`[hook] 配置有变化，已重新加载：${this.loaded.path}`);
    }
  }

  /** 新任务开始时把 Stop 的阻断计数清零 */
  resetStopBlocks(): void {
    this.stopBlocks = 0;
  }

  get stopBlockCount(): number {
    return this.stopBlocks;
  }

  // ─────────────────────── 4 个事件点 ───────────────────────

  /**
   * PreToolUse —— 工具调用【前】
   *
   * 能阻断：hook 明确返回非 0 退出码 → 这次工具调用被否决，
   *   否决理由回给模型（模型看到"被拒绝了，因为……"就能自己换策略）。
   */
  async runPreToolUse(
    tool: string,
    args: Record<string, unknown>,
    cwd: string,
    iteration?: number,
  ): Promise<HookOutcome> {
    return this.dispatch(
      'PreToolUse',
      { event: 'PreToolUse', cwd, tool, arguments: args, iteration },
      tool,
      true,
    );
  }

  /**
   * PostToolUse —— 工具调用【后】
   *
   * 不阻断。它是"通知型"的：跑完格式化、跑完 lint、记个审计日志。
   */
  async runPostToolUse(
    tool: string,
    args: Record<string, unknown>,
    result: { content: string; isError?: boolean },
    cwd: string,
    iteration?: number,
  ): Promise<HookOutcome> {
    return this.dispatch(
      'PostToolUse',
      { event: 'PostToolUse', cwd, tool, arguments: args, result, iteration },
      tool,
      false,
    );
  }

  /**
   * Stop —— agent 说"我做完了"，回合要结束的时候
   *
   * 能阻断：测试没过 → 把失败信息回给模型 → 模型继续干活。
   * ⭐ 这是整套机制最有价值的点：
   *   agent 最典型的失败是"声称改好了，其实没改对"，
   *   而它自己是【发现不了】的 —— 它跑一次测试看到绿色就收工。
   *   让 Stop hook 来当那个"不收工"的人。
   */
  async runStop(response: string, cwd: string, iteration?: number): Promise<HookOutcome> {
    let outcome = await this.dispatch(
      'Stop',
      { event: 'Stop', cwd, response, iteration },
      response,
      true,
    );

    // 内置的 Stop 检查（autoTest）
    //
    // ⚠️ 注意这里【不能提前 return】 ——
    //   提前 return 会绕过下面的"连续阻断上限"计数，
    //   内置 hook 就能无限打回（上限形同虚设）。
    //   这是写这个函数时真踩到的坑。
    if (!outcome.blocked && builtinStopCheck) {
      try {
        const r = await builtinStopCheck(cwd);
        if (!r.ok) {
          outcome = {
            blocked: true,
            reason: r.message,
            output: outcome.output,
            problem: outcome.problem,
          };
        }
      } catch (e: any) {
        // ⚠️ 内置检查自己挂了 → 不阻断（铁律 1）
        outcome = {
          blocked: false,
          output: outcome.output,
          problem: `内置 Stop 检查出错：${e?.message}`,
        };
      }
    }

    if (!outcome.blocked) return outcome;

    // ⭐ 连续阻断上限 —— 防死循环
    //   用户配的 hook 和内置 hook 都算进来
    this.stopBlocks++;
    if (this.stopBlocks > MAX_STOP_BLOCKS) {
      warn(
        `[hook] Stop hook 连续阻断 ${this.stopBlocks} 次（上限 ${MAX_STOP_BLOCKS}），强制放行`,
      );
      return {
        blocked: false,
        output: outcome.output,
        problem: `Stop hook 连续阻断超过上限（${MAX_STOP_BLOCKS} 次），已强制放行`,
      };
    }

    return outcome;
  }

  /**
   * UserPromptSubmit —— 用户刚发了一条消息
   *
   * 不阻断。它的输出会被注入到上下文里
   * （比如注入当前 git 分支、注入待办清单）。
   */
  async runUserPromptSubmit(prompt: string, cwd: string): Promise<HookOutcome> {
    return this.dispatch(
      'UserPromptSubmit',
      { event: 'UserPromptSubmit', cwd, prompt },
      prompt,
      false,
    );
  }

  // ─────────────────────── 内部实现 ───────────────────────

  /**
   * 跑某个事件下的所有 hook
   *
   * @param canBlock 该事件能不能阻断
   */
  private async dispatch(
    event: HookEvent,
    invocation: HookInvocation,
    subject: string,
    canBlock: boolean,
  ): Promise<HookOutcome> {
    // ⭐ 快速路径：没有任何 hook 就直接返回，不做文件 stat、不做正则
    if (!this.hasUserHooks) {
      return { blocked: false };
    }

    this.refreshIfChanged();

    const entries = entriesFor(this.loaded.config, event).filter((e) =>
      entryMatches(e, subject),
    );
    if (entries.length === 0) return { blocked: false };

    const outputs: string[] = [];
    const problems: string[] = [];

    for (const entry of entries) {
      for (const cmd of entry.hooks) {
        const r = await runHookCommand(
          cmd.command,
          invocation.cwd,
          invocation,
          cmd.timeoutMs,
        );

        // ── hook 自己出问题 → 只记日志，绝不阻断（铁律 1）──
        if (r.timedOut) {
          problems.push(`命令超时（${cmd.command}）`);
          continue;
        }
        if (r.notFound) {
          problems.push(`命令不存在（${cmd.command}）`);
          continue;
        }
        if (r.error) {
          problems.push(`命令启动失败（${cmd.command}）：${r.error}`);
          continue;
        }

        const text = (r.stdout || '').trim();
        if (text) outputs.push(text);

        // ── 明确非 0 退出码 = 否决 ──
        if (canBlock && r.exitCode !== null && r.exitCode !== 0) {
          return {
            blocked: true,
            reason: this.formatReason(event, cmd.command, r.exitCode, text, r.stderr),
            output: outputs.join('\n\n') || undefined,
            problem: problems.length ? problems.join('; ') : undefined,
          };
        }
      }
    }

    return {
      blocked: false,
      output: outputs.length ? outputs.join('\n\n') : undefined,
      problem: problems.length ? problems.join('; ') : undefined,
    };
  }

  /** 把 hook 的结果整理成模型能看懂的话 */
  private formatReason(
    event: HookEvent,
    command: string,
    exitCode: number,
    stdout: string,
    stderr: string,
  ): string {
    const parts: string[] = [];
    parts.push(`[${event} hook 拦截] 命令 \`${command}\` 退出码 ${exitCode}`);
    const body = [stdout, stderr].filter((s) => s && s.trim()).join('\n').trim();
    if (body) {
      parts.push('');
      parts.push(body.slice(0, 4000));
    }
    parts.push('');
    parts.push('请根据上面的信息修正后重试。');
    return parts.join('\n');
  }
}

// ─────────────────────── 模块级单例 ───────────────────────

let current: HookManager | undefined;
let currentRoot: string | undefined;

/**
 * 拿到当前工作区的 HookManager
 *
 * 工作区根变了（评测换沙箱、多根工作区）会自动重载。
 */
export function getHookManager(root?: string): HookManager {
  const r = root ?? getDefaultCwd();
  if (!current || currentRoot !== r) {
    current = HookManager.load(r);
    currentRoot = r;
  }
  return current;
}

/** 清掉单例（测试用） */
export function resetHookManager(): void {
  current = undefined;
  currentRoot = undefined;
}
