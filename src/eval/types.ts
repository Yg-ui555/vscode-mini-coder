/**
 * 评测任务的数据模型
 *
 * 一道题 = 一个目录（eval/tasks/NN-名字/）：
 *   task.md    给agent 看的任务描述（唯一输入）
 *   initial/   初始代码（会被复制到沙箱）
 *   check.js   验收脚本（自动判定，不依赖 LLM 打分）
 *
 * 为什么 check.js 必须是自动的：
 *   用 LLM 判分会出现"自我麻醉"—— 你出一道题，LLM 说做对了，你就信了。
 *   断言是二值的：0 或 1。这样pass rate 才有意义。
 *
 * check.js 导出形状：
 *   module.exports = {
 *     taskId: '01-input-validation',
 *     cases: [
 *       { name: '正常输入不报错', fn: ({ dir }) => { ... } },
 *     ]
 *   }
 *
 *   fn 收到的 ctx：
 *     dir         沙箱绝对路径
 *     finalAnswer agent 的最终回复文本（对抗题用得到）
 *     transcript  工具调用轨迹（对抗题用得到）
 *     task        任务元数据
 */

import * as fs from 'fs';
import * as path from 'path';

export type TaskTier = 'simple' | 'hard' | 'adversarial';

export const TIER_LABEL: Record<TaskTier, string> = {
  simple: '普通档',
  hard: '困难档',
  adversarial: 'L3 对抗档',
};

export interface CheckCase {
  name: string;
  fn: (ctx: CheckContext) => void | Promise<void>;
}

export interface CheckModule {
  taskId?: string;
  cases: CheckCase[];
}

export interface CheckContext {
  /** 沙箱绝对路径 */
  dir: string;
  /** agent 的最终文本回复 */
  finalAnswer: string;
  /** 工具调用轨迹（工具名 + 参数摘要 + 是否报错） */
  transcript: ToolTrace[];
  /** 任务元数据 */
  task: TaskMeta;
}

export interface ToolTrace {
  tool: string;
  args: any;
  isError: boolean;
  /** 结果内容前200 字 */
  preview: string;
}

export interface TaskMeta {
  id: string;
  tier: TaskTier;
  title: string;
  prompt: string;
  dir: string;
  initialDir: string;
  checkPath: string;
}

/** 评测目录（项目根下的 eval/） */
export function evalRoot(): string {
  // 编译后在 out/eval/，向上两级是项目根
  const candidates = [
    path.resolve(__dirname, '..', '..', 'eval'),
    path.resolve(__dirname, '..', 'eval'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('找不到 eval/ 目录（候选：' + candidates.join(' , ') + '）');
}

export function tasksDir(): string {
  return path.join(evalRoot(), 'tasks');
}

/**
 * 从目录名解析档位：
 *   01-simple-foo   → simple
 *   11-hard-foo     → hard
 *   21-adversarial-foo → adversarial
 */
function tierFromDirName(name: string): TaskTier {
  if (name.includes('adversarial')) return 'adversarial';
  if (name.includes('hard')) return 'hard';
  return 'simple';
}

export function loadAllTasks(): TaskMeta[] {
  const root = tasksDir();
  if (!fs.existsSync(root)) return [];

  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => /^\d\d-/.test(n))
    .sort();

  const tasks: TaskMeta[] = [];

  for (const name of dirs) {
    const dir = path.join(root, name);
    const taskMd = path.join(dir, 'task.md');
    const initialDir = path.join(dir, 'initial');
    const checkPath = path.join(dir, 'check.js');

    if (!fs.existsSync(taskMd)) {
      console.warn(`⚠ 跳过 ${name}：缺task.md`);
      continue;
    }
    if (!fs.existsSync(checkPath)) {
      console.warn(`⚠ 跳过 ${name}：缺 check.js`);
      continue;
    }

    tasks.push({
      id: name,
      tier: tierFromDirName(name),
      title: name.replace(/^\d\d-/, '').replace(/-/g, ' '),
      prompt: fs.readFileSync(taskMd, 'utf-8'),
      dir,
      initialDir,
      checkPath,
    });
  }

  return tasks;
}

/** 载入并校验 check.js 的导出形状 */
export function loadCheck(task: TaskMeta): CheckModule {
  // 清 require 缓存：同一进程跑多题时，check.js 路径不同不会冲突，
  // 但沙箱内的模块会变，必须清
  const resolved = require.resolve(task.checkPath);
  delete require.cache[resolved];

  const mod = require(resolved);

  if (!mod || !Array.isArray(mod.cases)) {
    throw new Error(`${task.id} 的 check.js 必须导出 { cases: [{ name, fn }] }`);
  }
  if (mod.cases.length === 0) {
    throw new Error(`${task.id} 的 check.js 没有 cases`);
  }
  for (const c of mod.cases) {
    if (!c.name || typeof c.fn !== 'function') {
      throw new Error(`${task.id} 的 check.js 里有 case 缺少 name 或 fn`);
    }
  }

  return mod;
}

/** 递归复制目录 */
export function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** 列出目录下所有文件（相对路径），用于记录 agent 实际改了什么 */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, prefix = '') => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(d, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}