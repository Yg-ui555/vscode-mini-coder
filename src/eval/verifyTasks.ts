/**
 * 校验所有题目的 baseline 设计是否合格
 *
 * 合格标准（三条同时满足）：
 *   1. check.js 能被 require，导出形状正确
 *   2. ⭐ baseline 至少 2 个 case 通过（回归守卫，否则 L4 是摆设）
 *   3. ⭐ baseline 至少 1 个 case 失败（目标 case，否则 agent 什么都不做也满分）
 *
 * 用法：node out/eval/verifyTasks.js
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { loadAllTasks, loadCheck, copyDir } from './types';

interface Issue {
  id: string;
  level: 'ERROR' | 'WARN';
  msg: string;
}

async function main() {
  const tasks = loadAllTasks();
  const issues: Issue[] = [];
  console.log(`\n🔍 校验 ${tasks.length} 道题的baseline 设计\n`);
  console.log('题目'.padEnd(30) + 'case 总数  baseline 过  baseline 挂  判定');
  console.log('─'.repeat(78));

  for (const task of tasks) {
    const row: Issue[] = [];

    let check;
    try {
      check = loadCheck(task);
    } catch (e: any) {
      issues.push({ id: task.id, level: 'ERROR', msg: `check.js 加载失败：${e.message}` });
      console.log(task.id.padEnd(30) + '❌ check.js 加载失败');
      continue;
    }

    // 建沙箱跑 baseline
    const sandbox = path.join(os.tmpdir(), `verify-${task.id}-${Date.now()}`);
    try {
      if (fs.existsSync(task.initialDir)) copyDir(task.initialDir, sandbox);
      else {
        fs.mkdirSync(sandbox, { recursive: true });
        row.push({ id: task.id, level: 'WARN', msg: '没有 initial/ 目录（空沙箱题）' });
      }

      let passed = 0;
      let failed = 0;
      const failedNames: string[] = [];

      for (const c of check.cases) {
        try {
          await c.fn({
            dir: sandbox,
            finalAnswer: '',
            transcript: [],
            task,
          });
          passed++;
        } catch (e: any) {
          failed++;
          failedNames.push(c.name);
        }
      }

      // 判定
      let verdict: string;
      if (passed < 2) {
        verdict = '❌ baseline 通过数 < 2（L4 无意义）';
        row.push({
          id: task.id,
          level: 'ERROR',
          msg: `baseline 只过 ${passed} 个 case，至少需要 2 个回归守卫`,
        });
      } else if (failed < 1) {
        verdict = '❌ baseline 全过（agent 不用干活就满分）';
        row.push({
          id: task.id,
          level: 'ERROR',
          msg: 'baseline 全部通过，题目没有"要达成"的目标 — 这题是废的',
        });
      } else {
        verdict = '✅ 合格';
      }

      console.log(
        task.id.padEnd(30) +
          String(check.cases.length).padEnd(11) +
          String(passed).padEnd(13) +
          String(failed).padEnd(13) +
          verdict,
      );
    } catch (e: any) {
      row.push({ id: task.id, level: 'ERROR', msg: `baseline 执行异常：${e.message}` });
      console.log(task.id.padEnd(30) + `❌ ${e.message}`);
    } finally {
      try {
        fs.rmSync(sandbox, { recursive: true, force: true });
      } catch {}
    }

    issues.push(...row);
  }

  console.log('\n' + '═'.repeat(78));
  const errors = issues.filter((i) => i.level === 'ERROR');
  const warns = issues.filter((i) => i.level === 'WARN');

  if (errors.length === 0 && warns.length === 0) {
    console.log(`✅ 全部 ${tasks.length} 道题 baseline 设计合格`);
  } else {
    if (errors.length) {
      console.log(`❌ ${errors.length} 个必须修的问题：\n`);
      for (const e of errors) console.log(`  [${e.id}] ${e.msg}`);
    }
    if (warns.length) {
      console.log(`\n⚠️  ${warns.length} 个提醒：\n`);
      for (const w of warns) console.log(`  [${w.id}] ${w.msg}`);
    }
  }
  console.log('');

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('校验脚本挂了：', e);
  process.exit(1);
});