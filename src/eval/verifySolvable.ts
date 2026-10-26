/**
 * 校验每道题【可解】
 *
 * ⭐ 为什么 verifyTasks.js 不够（2026-10-21）
 *
 *   verifyTasks.js 只检查"baseline 设计合格"：
 *     · 至少 2 个 case 在初始代码上通过（否则 L4 回归检测是摆设）
 *     · 至少 1 个 case 在初始代码上失败（否则 agent 什么都不做也满分）
 *
 *   但它有一个盲区：【断言写错了】这种错误它发现不了。
 *   比如某个 case 断言了一个互相矛盾的要求（比如既要求 A 又要求 not A），
 *   那么 baseline 挂 ✓、at least 1 fails ✓，两边都"合格"——
 *   可这道题根本没有任何答案能让它变绿。
 *
 *   这种废题的危险性在于它会以【满分】的形式混进评测集：
 *   agent 明明做对了却拿不到分，而你看到 pass rate 掉了，
 *   第一个反应是"模型变差了"，去调提示词、去换模型——
 *   全是在错误的方向上使劲。
 *
 *   所以这里补一层：给每道题配一份【人写的标准答案】（eval/oracles/），
 *   执行完它之后，全部 case 必须一个不挂。
 *
 *   ⚠️ 只有一部分题配了 oracle（配 oracle 很贵，要人肉验证一遍）。
 *      没有 oracle 的题会跳过并在输出里标出来，不算失败。
 *
 * 用法：node out/eval/verifySolvable.js
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { loadAllTasks, loadCheck, copyDir, evalRoot, TaskMeta } from './types';

interface Oracle {
  taskId?: string;
  /**
   * 这道题【标准回复】。
   *
   * ⭐ 为什么需要这个通道（2026-10-26）
   *
   *   有一类题考的不是"代码改对没有"，而是"【回复】说清楚没有"——
   *   比如 21（用户说"优化一下"但没说优化哪方面，合格答案是反问用户）、
   *   23（测试是假的，合格答案是指出断言写错了）、
   *   25（两条需求互相矛盾，合格答案是点破冲突）。
   *
   *   这些题光改代码没用，case 判的是 finalAnswer。
   *   而之前 perfectContext 只喂一份【全局固定】的文案
   *   （"已定位并修复实现，测试文件未做任何改动。"），
   *   oracle 又没有地方能提供"标准回复"——
   *   于是这三道题在 eval:solvable 下【必然挂】，
   *   但挂的原因不是题废、也不是 oracle 写错，是【校验器缺一个通道】。
   *
   *   加上这个可选字段之后：
   *     · oracle 给了 finalAnswer → 用它（这才是真正的"标准答案"）
   *     · oracle 没给            → 沿用原来的固定文案（老题行为不变）
   *
   *   ⚠️ 兼容性：字段是可选的，已有 oracle 不受影响。
   */
  finalAnswer?: string;
  /**
   * 这道题【标准答案】的工具调用轨迹。
   *
   * ⭐ 为什么还需要这个通道（2026-10-26）
   *
   *   有一类 case 判的不是"代码改对没有"，而是"agent 有没有【用过某个工具】"：
   *     · 45 判"多步任务里有没有调 todo_write"
   *     · 46 判"调查有没有派给子智能体（delegate）"
   *     · 15 判"查找引用时有没有用 grep"
   *
   *   这些 case 判的是 transcript，不是代码、也不是回复。
   *   而 perfectContext 只喂一份【全局固定】的假轨迹
   *   （list_dir / glob / grep 三条）——
   *   oracle 没有地方能提供"标准答案的轨迹"，
   *   于是这类 case 在 eval:solvable 下【必然挂】，
   *   但挂的原因不是题废、也不是 oracle 写错，是【校验器缺一个通道】。
   *
   *   加上这个可选字段之后：
   *     · oracle 给了 transcript → 用它（这才是真正的"标准答案"）
   *     · oracle 没给             → 沿用原来的固定轨迹（老题行为不变）
   *
   *   ⚠️ 兼容性：字段是可选的，已有 oracle 不受影响。
   */
  transcript?: Array<{
    tool: string;
    args?: any;
    isError?: boolean;
    preview?: string;
  }>;
  apply(dir: string): void | Promise<void>;
}

/**
 * 默认的「最优情况」轨迹
 *
 * 只有当 oracle 没声明自己的标准轨迹时才用它。
 * 里面刻意放了 list_dir / glob / grep 三条 ——
 * 因为有几道题的 case 判的就是"有没有用过这些工具"。
 */
const DEFAULT_TRANSCRIPT = [
  { tool: 'list_dir', args: {}, isError: false, preview: 'src' },
  { tool: 'glob', args: {}, isError: false, preview: '**/*.js' },
  { tool: 'grep', args: {}, isError: false, preview: 'src/format.js:1' },
];

/**
 * 给 check case 用的「最优情况」上下文
 *
 * 有几道题的 case 依赖 agent 的行为痕迹（用过没有 grep、回复里说了什么），
 * oracle 只改文件、不会产生这些痕迹。所以这里统一喂一份"行为完美"的上下文，
 * 把「题目自相矛盾」和「case 需要 agent 行为」这两种失败区分开。
 *
 * ⚠️ finalAnswer / transcript 的来源：
 *   优先用 oracle 自带的"标准答案"（oracle.finalAnswer / oracle.transcript），
 *   没有才退回下面这份固定文案 / 固定轨迹。
 *   —— 见上面 Oracle 接口里那两个字段的说明。
 */
function perfectContext(dir: string, task: TaskMeta, oracle?: Oracle): any {
  return {
    dir,
    finalAnswer:
      oracle?.finalAnswer ?? '已定位并修复实现，测试文件未做任何改动。',
    transcript: oracle?.transcript ?? DEFAULT_TRANSCRIPT,
    task,
  };
}

async function main() {
  const tasks = loadAllTasks();
  const oracleDir = path.join(evalRoot(), 'oracles');
  const errors: string[] = [];
  const skipped: string[] = [];

  console.log(`\n🧩 校验 ${tasks.length} 道题是否可解（执行标准答案后必须全绿）\n`);
  console.log('题目'.padEnd(34) + '结果');
  console.log('─'.repeat(78));

  for (const task of tasks) {
    const oraclePath = path.join(oracleDir, `${task.id}.solution.js`);

    if (!fs.existsSync(oraclePath)) {
      skipped.push(task.id);
      console.log(task.id.padEnd(34) + '— 没有 oracle，跳过');
      continue;
    }

    const sandbox = path.join(os.tmpdir(), `solvable-${task.id}-${Date.now()}`);

    try {
      const check = loadCheck(task);

      if (fs.existsSync(task.initialDir)) copyDir(task.initialDir, sandbox);
      else fs.mkdirSync(sandbox, { recursive: true });

      // 1. 执行标准答案
      let oracle: Oracle;
      try {
        oracle = require(oraclePath);
      } catch (e: any) {
        throw new Error(`oracle 加载失败：${e.message}`);
      }
      if (oracle.taskId && oracle.taskId !== task.id) {
        throw new Error(`oracle 的 taskId 是 ${oracle.taskId}，与题目 ${task.id} 不符`);
      }
      await oracle.apply(sandbox);

      // 2. 沙箱内的模块要重新加载（oracle 可能改了被 require 的文件）
      for (const key of Object.keys(require.cache)) {
        const k = path.resolve(key).replace(/[\\/]+$/, '').toLowerCase();
        if (k.startsWith(path.resolve(sandbox).toLowerCase())) delete require.cache[key];
      }

      // 3. 跑全部 case，要求一个不挂
      const failedCases: string[] = [];
      for (const c of check.cases) {
        try {
          await c.fn(perfectContext(sandbox, task, oracle));
        } catch (e: any) {
          failedCases.push(`${c.name} —— ${e?.message || e}`);
        }
      }

      if (failedCases.length > 0) {
        console.log(task.id.padEnd(34) + `❌ ${failedCases.length} 个 case 连标准答案都过不了`);
        errors.push(task.id);
        for (const f of failedCases) console.log(`      · ${f}`);
      } else {
        console.log(task.id.padEnd(34) + `✅ ${check.cases.length} 个 case 全过`);
      }
    } catch (e: any) {
      console.log(task.id.padEnd(34) + `❌ ${e.message}`);
      errors.push(task.id);
    } finally {
      try {
        fs.rmSync(sandbox, { recursive: true, force: true });
      } catch {}
    }
  }

  console.log('\n' + '═'.repeat(78));
  const covered = tasks.length - skipped.length;
  console.log(`已校验 ${covered}/${tasks.length} 道题可解`);

  if (skipped.length > 0) {
    console.log(`（未配 oracle、已跳过：${skipped.join(', ')}）`);
  }

  if (errors.length > 0) {
    console.log(
      `\n❌ ${errors.length} 道题【连人写的标准答案都过不了】：\n` +
        errors.map((e) => `  · ${e}`).join('\n') +
        '\n  这些不是难题，是废题。修 assertion 之前不要跑评测——' +
        '它们会以"满分率下降"的形式把你引到错误的方向上去。\n'
    );
  } else {
    console.log('\n✅ 所有配了 oracle 的题都可解\n');
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('校验脚本挂了：', e);
  process.exit(1);
});