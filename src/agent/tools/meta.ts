/**
 * 工具元数据 —— 决定"这个工具要不要问用户"和"要不要先存快照"
 *
 * ⭐ 借鉴来源（两个参考项目在这一块各有取舍）：
 *
 *   nanobot（tools/base.py:217-229）：给 Tool 基类加 read_only /
 *     exclusive / concurrency_safe 三个属性。read_only 的工具可以自动放行、
 *     可以并行执行。
 *
 *   goose（tool_inspection.rs + platform_extensions/mod.rs:115-159）：
 *     给每个工具标 read_only_hint / destructive_hint / idempotent_hint /
 *     open_world_hint。权限模块用 read_only_hint 做"全是只读工具就直接放行"
 *     的启发式。
 *
 *   本项目取两家之长，简化成四个字段：
 *     - readOnly      无副作用 → 权限分级里自动放行，且允许并行
 *     - destructive   不可逆或影响系统 → 必须确认 + 强制存 checkpoint
 *     - concurrentSafe 可否和其他工具并发
 *     - needsCheckpoint 是否需要在执行前存快照（destructive 的通常为 true）
 *
 * ⚠️ 不要学 goose 的 LLM-as-judge 权限判定（permission/permission_judge.rs）：
 *   它每个工具调用前额外调一次 LLM 判断"这操作是不是只读"。又慢、又烧钱、
 *   边界还判不准，goose 团队自己都主要靠静态标注兜底。静态元数据足够。
 */

/** 只读工具名单（/doctor 和文档共用，避免两处手写不一致） */
export const ReadOnlyToolNames = [
  'read_file',
  'grep',
  'glob',
  'list_dir',
] as const;

export interface ToolMeta {
  /**
   * 无副作用吗？
   * true  → 权限分级里自动放行，且可以和别的工具并发执行
   * false → 需要按当前权限模式决定是否问用户
   */
  readOnly: boolean;

  /**
   * 破坏性吗？（删除、覆盖、执行外部命令）
   * true  → 无论权限模式如何，弹窗确认前都会先落 checkpoint
   */
  destructive: boolean;

  /** 可以和其他工具并发执行吗？（比如两个 grep 可以同时跑） */
  concurrentSafe: boolean;

  /** 执行前是否需要先存文件快照 */
  needsCheckpoint: boolean;
}

/** 便捷构造：只读工具 */
export function readOnlyMeta(concurrentSafe = true): ToolMeta {
  return { readOnly: true, destructive: false, concurrentSafe, needsCheckpoint: false };
}

/** 便捷构造：写入类工具（要确认 + 要 checkpoint） */
export function writeMeta(): ToolMeta {
  return { readOnly: false, destructive: true, concurrentSafe: false, needsCheckpoint: true };
}

/** 便捷构造：执行类工具（要确认，checkpoint 只在显式动文件时才有意义） */
export function execMeta(needsCheckpoint = false): ToolMeta {
  return { readOnly: false, destructive: true, concurrentSafe: false, needsCheckpoint };
}
