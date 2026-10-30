/**
 * 文件 Checkpoint —— 每次写文件前先存快照，让 AI 改错了能一键还原
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 为什么这是 Mini-Coder 最值得做的差异化功能
 *
 * 我把两个参考项目都翻了一遍：
 *
 *   goose：官方 blog 自己承认 —— "As asking the agent to revert is often
 *          futile, as conversational memory isn't a snapshot of your
 *          codebase." 它【没有】文件级回滚，让用户自己 git commit 救。
 *
 *   nanobot：全仓 grep `rollback|undo|revert`，只命中会话目录迁移和 MCP
 *          清理。它的 runtime_checkpoint 只恢复"轮次进度"，
 *          【不撤销已写文件】。
 *
 *   也就是说「改了能退回来」这件事，两个工业级项目都没做。
 *   而这是 AI 编程助手最让人崩溃的场景：它把好好的代码改坏了，
 *   你只能 Ctrl+Z 一次次盲退，不知道退到哪一步才对。
 *
 *   有回滚 + 改前确认 = 用户敢放手让它改 = 留存；没有 = 用户不敢用。
 * ─────────────────────────────────────────────────────────────
 *
 * 设计取舍：
 *   1. 一次工具调用 = 一个 checkpoint（不是一次文件一个）
 *      apply_patch 一次改 5 个文件，应该能一次性全退回，
 *      而不是让用户点 5 次。
 *   2. 存【原内容】而不是 diff
 *      diff 要有基准文件才能还原；原内容直接写回去，简单且绝对不会错。
 *      代价是占磁盘 —— 但只保留最近 N 个操作，且单文件超 1MB 不存。
 *   3. 写盘用「临时文件 + rename」原子替换
 *      抄 goose 的 permission_store.rs:67-76。
 *      中途崩溃不会留下半个损坏的 checkpoint。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getDefaultCwd, toWorkspaceRelative } from '../tools/paths';

/** checkpoint 根目录名（相对工作区） */
export const CHECKPOINT_DIR = '.mini-coder/checkpoints';

/** 最多保留多少个 checkpoint（超出删最旧的） */
export const MAX_CHECKPOINTS = 100;

/** 单文件超过这个大小就不存快照（太大了，存了也没意义） */
const MAX_SNAPSHOT_BYTES = 1 * 1024 * 1024; // 1MB

/** 一次操作的 checkpoint 内容 */
export interface Checkpoint {
  id: string;
  seq: number;
  sessionKey: string;
  tool: string;
  ts: string;
  /** 是否已被 /undo 撤销过 */
  restored: boolean;
  files: CheckpointFile[];
}

export interface CheckpointFile {
  /** 相对工作区的路径（跨机器可移植） */
  path: string;
  /** 改之前是否就存在这个文件 */
  existed: boolean;
  /** 改之前的内容；existed=false 时为 null（还原时删除该文件） */
  before: string | null;
}

export interface SnapshotInput {
  absPath: string;
  /** 原内容；传 null 表示"这个文件本来不存在" */
  before: string | null;
}

/** 当前会话 key。激活时设置一次，让 VS Code 重开后还能 undo */
let currentSessionKey = '';

/**
 * checkpoint 总开关
 *
 * ⭐ 为什么需要这个开关（2026-10-21）
 *
 *   评测沙箱里【必须关掉】checkpoint。原因：
 *     src/eval/types.ts 的 listFiles() 不忽略任何目录，会把
 *     sandbox/.mini-coder/checkpoints/... 全算进"agent 改了哪些文件"。
 *     那样评测报告的 changedFiles 就被自己的存档污染了 ——
 *     而 changedFiles 正是 L4 回归检测的辅助证据。
 *
 *   更根本的原因：评测要回答的是"agent 能不能把代码改对"，
 *   checkpoint 回答的是"agent 改错了能不能退回来"，两件事。
 *   沙箱里没有"退回来"这个概念，也不该有。
 *
 *   沙箱在 finally 里本来就会被整个 rmSync 掉，快照存了也是白存。
 */
let checkpointEnabled = true;

/** 开关 checkpoint（评测沙箱里关掉） */
export function setCheckpointEnabled(enabled: boolean): void {
  checkpointEnabled = enabled;
}

/** 设置当前会话（由 extension 激活或新建会话时调用） */
export function setCheckpointSession(key: string): void {
  currentSessionKey = key;
}

export function getCheckpointSession(): string {
  return currentSessionKey;
}

/** 工作区根目录下的 checkpoint 目录 */
function checkpointsRoot(): string {
  return path.join(getDefaultCwd(), CHECKPOINT_DIR);
}

function sessionDir(): string {
  const key = currentSessionKey || 'default';
  return path.join(checkpointsRoot(), key);
}

/** 内容哈希，用于判断文件是否真的变了 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
}

/** 原子写：先写 .tmp 再 rename，避免崩溃留下半截文件 */
function atomicWrite(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 清理失败不致命 */
    }
    throw e;
  }
}

/**
 * 存一次工具调用的快照
 *
 * @param tool    哪个工具要写（apply_patch / write_file）
 * @param inputs  要写的文件 + 它们改之前的内容
 * @returns checkpoint id；没存成返回 null（不阻塞主流程）
 */
export function snapshotOperation(tool: string, inputs: SnapshotInput[]): string | null {
  if (inputs.length === 0) return null;
  if (!checkpointEnabled) return null;

  const files: CheckpointFile[] = [];

  for (const input of inputs) {
    // 太大就不存 —— 存了也是浪费磁盘，还原价值低
    if (input.before !== null && Buffer.byteLength(input.before, 'utf-8') > MAX_SNAPSHOT_BYTES) {
      continue;
    }
    files.push({
      path: toWorkspaceRelative(input.absPath),
      existed: input.before !== null,
      before: input.before,
    });
  }

  if (files.length === 0) return null;

  const dir = sessionDir();
  const existing = listCheckpoints();
  const seq = existing.length > 0 ? Math.max(...existing.map((c) => c.seq)) + 1 : 1;

  const cp: Checkpoint = {
    id: `cp-${seq}-${Date.now().toString(36)}`,
    seq,
    sessionKey: currentSessionKey || 'default',
    tool,
    ts: new Date().toISOString(),
    restored: false,
    files,
  };

  try {
    fs.mkdirSync(dir, { recursive: true });
    atomicWrite(path.join(dir, `${cp.id}.json`), JSON.stringify(cp, null, 2));
    pruneOld(dir);
    return cp.id;
  } catch {
    // 存快照失败不能阻断用户干活 —— 静默降级
    return null;
  }
}

/** 列出当前会话的 checkpoint（按 seq 倒序，最新在前） */
export function listCheckpoints(): Checkpoint[] {
  const dir = sessionDir();
  if (!fs.existsSync(dir)) return [];

  const out: Checkpoint[] = [];
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }

  for (const f of files) {
    if (!f.endsWith('.json') || f.includes('.tmp-')) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
      const cp = JSON.parse(raw) as Checkpoint;
      if (cp && typeof cp.seq === 'number' && Array.isArray(cp.files)) {
        out.push(cp);
      }
    } catch {
      // 单个文件损坏不影响其他
    }
  }

  return out.sort((a, b) => b.seq - a.seq);
}

/** 找一个文件最近一次还有效的 checkpoint（用于 restore_file 工具） */
export function latestCheckpointFor(relPath: string): Checkpoint | undefined {
  return listCheckpoints().find(
    (cp) => !cp.restored && cp.files.some((f) => f.path === relPath),
  );
}

export interface RestoreResult {
  ok: boolean;
  restoredFiles: string[];
  errors: string[];
  message: string;
}

/** 还原一个 checkpoint */
export function restoreCheckpoint(id: string): RestoreResult {
  const dir = sessionDir();
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) {
    return { ok: false, restoredFiles: [], errors: ['checkpoint 不存在'], message: `找不到快照 ${id}` };
  }

  let cp: Checkpoint;
  try {
    cp = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e: any) {
    return { ok: false, restoredFiles: [], errors: [e.message], message: '快照文件损坏' };
  }

  if (cp.restored) {
    return {
      ok: false,
      restoredFiles: [],
      errors: ['已还原过'],
      message: `快照 ${id} 之前已经还原过了（重复还原会覆盖用户之后的修改）`,
    };
  }

  const root = getDefaultCwd();
  const restoredFiles: string[] = [];
  const errors: string[] = [];

  for (const f of cp.files) {
    const abs = path.resolve(root, f.path);
    try {
      if (f.existed && f.before !== null) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.before, 'utf-8');
        restoredFiles.push(`${f.path}（还原原内容）`);
      } else {
        // 本来不存在的文件 = 直接删掉
        if (fs.existsSync(abs)) {
          fs.unlinkSync(abs);
          restoredFiles.push(`${f.path}（删除新建的文件）`);
        }
      }
    } catch (e: any) {
      errors.push(`${f.path}: ${e.message}`);
    }
  }

  if (errors.length === 0) {
    try {
      cp.restored = true;
      atomicWrite(file, JSON.stringify(cp, null, 2));
    } catch {
      /* 标记失败不影响还原结果 */
    }
  }

  const when = new Date(cp.ts).toLocaleString('zh-CN');
  const message =
    errors.length === 0
      ? `✅ 已还原 ${restoredFiles.length} 个文件（${cp.tool}，${when}）：\n` +
        restoredFiles.map((r) => `  • ${r}`).join('\n')
      : `⚠ 部分还原失败（${restoredFiles.length} 成功 / ${errors.length} 失败）：\n` +
        errors.map((e) => `  • ${e}`).join('\n');

  return { ok: errors.length === 0, restoredFiles, errors, message };
}

/** 还原最近一次未还原的 checkpoint（/undo 用） */
export function restoreLatest(): { result: RestoreResult; checkpoint?: Checkpoint } {
  const candidates = listCheckpoints().filter((cp) => !cp.restored);
  if (candidates.length === 0) {
    return {
      result: {
        ok: false,
        restoredFiles: [],
        errors: [],
        message: '没有可还原的修改记录（本次会话要么没改过文件，要么已经全部还原过了）。',
      },
    };
  }
  const target = candidates[0];
  return { result: restoreCheckpoint(target.id), checkpoint: target };
}

/** 丢弃一个 checkpoint（用户拒绝了操作、或写盘失败已自行回滚时调用） */
export function discardCheckpoint(id: string): void {
  try {
    const file = path.join(sessionDir(), `${id}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* 清理失败不致命 */
  }
}

/** 清掉超过上限的最旧 checkpoint */
function pruneOld(dir: string): void {
  const all = listCheckpoints();
  if (all.length <= MAX_CHECKPOINTS) return;
  const toRemove = all.slice(MAX_CHECKPOINTS); // all 是倒序，尾部最旧
  for (const cp of toRemove) {
    try {
      fs.unlinkSync(path.join(dir, `${cp.id}.json`));
    } catch {
      /* 忽略 */
    }
  }
}

/** 清空当前会话所有 checkpoint */
export function clearCheckpoints(): void {
  const dir = sessionDir();
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

/** 人类可读的快照摘要（/undo 弹窗用） */
export function describeCheckpoint(cp: Checkpoint): string {
  const files = cp.files.map((f) => `  • ${f.path}${f.existed ? '' : '（新建）'}`).join('\n');
  return `${cp.tool} · ${new Date(cp.ts).toLocaleString('zh-CN')} · ${cp.files.length} 个文件\n${files}`;
}
