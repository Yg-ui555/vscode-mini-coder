/**
 * 会话持久化 —— 关掉 VS Code 再打开，对话还在
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么这是必须做的（不是"锦上添花"）
 *
 *   改造前：ChatPanel._messages 是纯内存数组。关面板 = 全没了。
 *   后果一：用户重启 VS Code 要把需求重新解释一遍 —— 这是最直接的流失点。
 *   后果二：没法做多轮对比测试，没法回看三天前那次会话到底聊了啥。
 *
 * ─────────────────────────────────────────────────────────────
 * 借鉴：nanobot 的 JsonlSessionStore（nanobot/session/manager.py:448）
 *
 *   一个会话一个文件，格式：
 *     第 1 行  {"_type":"metadata", id, title, createdAt, ...}
 *     第 2 行  {"_type":"message", role, content, ...}
 *     第 3 行  {"_type":"message", role, content, ...}
 *
 *   为什么用 JSONL（一行一个 JSON）而不是一个大 JSON 数组：
 *     - 可以【追加写】，写到一半崩溃不会像单个大 JSON 那样全丢
 *     - 可以直接 grep / 用记事本打开看，出问题时排障方便
 *     - 行数就是消息数，肉眼可数
 *
 *   写入策略：这里用「全量重写 + 原子替换」而不是逐行追加。
 *     理由：对话经过 autocompact 后长度有界（几十条），全量重写成本可忽略；
 *     而原子替换能保证"要么是完整的旧版本，要么是完整的新版本"，
 *     不会出现半截记录。逐行追加的崩溃恢复留给后续（见文末 TODO）。
 *
 * ─────────────────────────────────────────────────────────────
 * 存储位置（借鉴 nanobot 的三层 workspace 分离，docs/architecture.md:158-168）
 *
 *   对话历史   → context.storageUri      （属于这个项目，卸载扩展才清）
 *   跨项目偏好 → context.globalStorageUri（换仓库也保留，比如模型偏好）
 *
 *   按工作区哈希分子目录：A 项目的会话不会和 B 项目混在一起。
 * ─────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { repairMessages } from '../util/historyRepair';
import { warn } from '../logger';

export interface SessionMeta {
  _type: 'metadata';
  id: string;
  title: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  provider?: string;
  model?: string;
  /**
   * ⭐ 多步任务的待办清单（2026-10-26）
   *
   *   为什么必须存在【会话文件】里，而不是只在内存：
   *     待办清单就像航班号 —— 写在黑板上，飞机降落后黑板擦了，
   *     旅客就不知道自己该转哪个航站楼。
   *
   *   还有一个更硬的理由：上下文压缩会压掉对话历史。
   *   如果待办状态只存在于某条历史消息里，压缩之后它就跟着没了 ——
   *   agent 会"忘了"自己走到第几步，然后重复做或者干脆从头再来。
   *
   *   所以状态存 session，消息流会被压缩，状态不会。
   *   （借鉴 goose 的 session/extension_data.rs）
   */
  todos?: Array<{ content: string; status: string; activeForm?: string }>;
}

export interface StoredMessage {
  _type: 'message';
  role: string;
  content: any;
  ts: string;
  /** tool_calls / tool_call_id 等原样保留 */
  tool_calls?: any[];
  tool_call_id?: string;
  /**
   * ⭐ 双可见性（2026-10-24）
   *
   *   agentVisible=false → 这条消息【不再发给模型】，但仍保留在文件里，
   *   用户在面板里仍能滚动查看（灰显状态）。
   *
   *   借鉴 goose 的 MessageMetadata { user_visible, agent_visible }
   *   （goose-provider-types/src/conversation/message.rs:828-834）
   *
   *   语义：
   *     · undefined / true → 两边都可见（默认）
   *     · agentVisible: false → 只对用户可见
   *     · userVisible: false → 只对模型可见（比如压缩摘要）
   */
  agentVisible?: boolean;
  userVisible?: boolean;
}

export type StoredLine = SessionMeta | StoredMessage;

export interface LoadedSession {
  meta: SessionMeta | null;
  messages: any[];
}

const SESSIONS_DIR = 'sessions';
const INDEX_FILE = 'index.json';

interface WorkspaceIndex {
  currentSessionId: string;
}

/** 工作区路径 → 短哈希（做目录名，避免路径里的非法字符） */
export function hashWorkspace(workspacePath: string): string {
  return crypto.createHash('sha1').update(workspacePath || 'no-workspace').digest('hex').slice(0, 12);
}

export class SessionStore {
  private readonly workspacePath: string;
  private readonly wsDir: string;
  private readonly indexPath: string;
  private currentId: string;

  constructor(
    /** 扩展的 storageUri.fsPath（会话归属这个项目） */
    private baseDir: string,
    workspacePath: string,
  ) {
    this.workspacePath = workspacePath;
    this.wsDir = path.join(baseDir, SESSIONS_DIR, hashWorkspace(workspacePath));
    this.indexPath = path.join(this.wsDir, INDEX_FILE);
    this.currentId = this.readIndex().currentSessionId;
  }

  // ───────────────── 索引 ─────────────────

  private readIndex(): WorkspaceIndex {
    try {
      const raw = fs.readFileSync(this.indexPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.currentSessionId === 'string') return parsed;
    } catch {
      /* 首次运行，没有索引 */
    }
    const fresh: WorkspaceIndex = { currentSessionId: this.newId() };
    this.writeIndex(fresh);
    return fresh;
  }

  private writeIndex(idx: WorkspaceIndex): void {
    try {
      fs.mkdirSync(this.wsDir, { recursive: true });
      fs.writeFileSync(this.indexPath, JSON.stringify(idx, null, 2), 'utf-8');
    } catch {
      /* 索引写失败不影响主流程 */
    }
  }

  private newId(): string {
    return `s-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  }

  get currentSessionId(): string {
    return this.currentId;
  }

  private sessionFile(sessionId: string): string {
    // 防路径穿越：sessionId 只允许字母数字和短横
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(this.wsDir, `${safe}.jsonl`);
  }

  // ───────────────── 写 ─────────────────

  /** 原子写：tmp + rename，避免崩溃留下半截文件（抄 goose permission_store.rs:67） */
  private atomicWrite(target: string, content: string): void {
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
   * 保存整个会话（覆盖写）
   *
   * @param messages 当前完整消息数组（含 system prompt）
   * @param extra    额外写入 meta 的信息（provider / model）
   */
  save(messages: any[], extra?: {
    provider?: string;
    model?: string;
    title?: string;
    todos?: Array<{ content: string; status: string; activeForm?: string }>;
  }): SessionMeta {
    const sessionId = this.currentId;
    const now = new Date().toISOString();

    const existing = this.loadMeta(sessionId);
    const meta: SessionMeta = {
      _type: 'metadata',
      id: sessionId,
      title:
        extra?.title ||
        existing?.title ||
        deriveTitle(messages) ||
        '未命名会话',
      workspacePath: this.workspacePath,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      messageCount: messages.length,
      provider: extra?.provider ?? existing?.provider,
      model: extra?.model ?? existing?.model,
      // ⭐ 待办清单：本次有就更新，没有就沿用上次的
      //   （没传不代表清空了 —— 清空是"显式传空数组"）
      todos: extra?.todos ?? existing?.todos,
    };

    const lines: string[] = [JSON.stringify(meta)];

    for (const m of messages) {
      const stored: StoredMessage = {
        _type: 'message',
        role: m.role,
        content: m.content ?? '',
        ts: now,
      };
      if (m.tool_calls) stored.tool_calls = m.tool_calls;
      if (m.tool_call_id) stored.tool_call_id = m.tool_call_id;
      if (m.agentVisible === false) stored.agentVisible = false;
      if (m.userVisible === false) stored.userVisible = false;
      lines.push(JSON.stringify(stored));
    }

    this.atomicWrite(this.sessionFile(sessionId), lines.join('\n') + '\n');
    return meta;
  }

  // ───────────────── 读 ─────────────────

  /** 读取会话（默认当前会话） */
  load(sessionId?: string): LoadedSession {
    const file = this.sessionFile(sessionId ?? this.currentId);
    if (!fs.existsSync(file)) return { meta: null, messages: [] };

    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf-8');
    } catch {
      return { meta: null, messages: [] };
    }

    const lines = raw.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return { meta: null, messages: [] };

    let meta: SessionMeta | null = null;
    const messages: any[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed?._type === 'metadata') {
          meta = parsed;
          continue;
        }
        if (parsed?._type === 'message') {
          const m: any = {
            role: parsed.role,
            content: parsed.content ?? '',
          };
          if (parsed.tool_calls) m.tool_calls = parsed.tool_calls;
          if (parsed.tool_call_id) m.tool_call_id = parsed.tool_call_id;
          if (parsed.agentVisible === false) m.agentVisible = false;
          if (parsed.userVisible === false) m.userVisible = false;
          messages.push(m);
        }
      } catch {
        // 单行损坏跳过，不影响其他行（JSONL 的好处之一）
      }
    }

    // ⭐⭐ 历史自愈（2026-10-22）
    //
    //   为什么这里必须自愈，而不是只在 loop 里"不产生坏数据"：
    //     · 用户磁盘上【已经存在】的坏会话文件不会自己变好
    //     · 修复前的版本，只要用户在多工具调用时点过停止，就留下了 400 的地雷
    //     · 不自愈的话，用户只能手动删 .jsonl，而且完全不知道问题在哪
    //
    //   自愈规则见 util/historyRepair.ts。要点：
    //     · 孤儿 tool_call（assistant 声明了但没响应）→ 补一条明确说明
    //     · 孤立 tool 消息（找不到对应声明）→ 替换成说明性内容
    //   两条规则都【不删信息】，因为删掉会让模型以为"没发生过"从而重做一遍副作用。
    //
    //   失败绝对不能阻断：会话坏了顶多丢一次对话，
    //   但如果这里抛异常，用户连"打开面板"都做不到，那就从"对话丢一次"
    //   升级成"插件不可用"了。
    let messagesWithRepair = messages;
    try {
      const repair = repairMessages(messages);
      if (repair.changed) {
        warn(
          `会话 ${sessionId} 历史结构异常，已自动修复：${repair.summary}。` +
            `（说明这条会话是在历史自愈上线前写的，或上一次任务被强制中断）`,
        );
        messagesWithRepair = repair.messages;
      }
    } catch (e: any) {
      warn(`会话 ${sessionId} 历史修复失败，按原样加载：${e?.message || e}`);
    }

    return { meta, messages: messagesWithRepair };
  }

  loadMeta(sessionId: string): SessionMeta | null {
    const file = this.sessionFile(sessionId);
    if (!fs.existsSync(file)) return null;
    try {
      const first = fs.readFileSync(file, 'utf-8').split('\n')[0];
      const parsed = JSON.parse(first);
      return parsed?._type === 'metadata' ? parsed : null;
    } catch {
      return null;
    }
  }

  /** 列出该工作区下所有会话（按最近更新排序） */
  list(): SessionMeta[] {
    if (!fs.existsSync(this.wsDir)) return [];
    let out: SessionMeta[] = [];
    try {
      for (const f of fs.readdirSync(this.wsDir)) {
        if (!f.endsWith('.jsonl')) continue;
        const meta = this.loadMeta(f.replace(/\.jsonl$/, ''));
        if (meta) out.push(meta);
      }
    } catch {
      return [];
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // ───────────────── 会话管理 ─────────────────

  /** 开一个新会话（清空当前指针） */
  startNew(): SessionMeta {
    const id = this.newId();
    this.currentId = id;
    this.writeIndex({ currentSessionId: id });
    return {
      _type: 'metadata',
      id,
      title: '未命名会话',
      workspacePath: this.workspacePath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
    };
  }

  /** 切换到某个已有会话 */
  switchTo(sessionId: string): boolean {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!fs.existsSync(this.sessionFile(safe))) return false;
    this.currentId = safe;
    this.writeIndex({ currentSessionId: safe });
    return true;
  }

  /** 删除会话；删的是当前会话时自动开新的 */
  delete(sessionId: string): void {
    try {
      const f = this.sessionFile(sessionId);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      /* 忽略 */
    }
    if (this.currentId === sessionId) this.startNew();
  }

  /** 当前会话是否已有内容 */
  hasContent(): boolean {
    const file = this.sessionFile(this.currentId);
    if (!fs.existsSync(file)) return false;
    try {
      return fs.readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim()).length > 1;
    } catch {
      return false;
    }
  }
}

/** 用第一条用户消息当会话标题 */
function deriveTitle(messages: any[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && typeof m.content === 'string');
  if (!firstUser) return '';
  const text = (firstUser.content as string).trim().replace(/\s+/g, ' ');
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}
