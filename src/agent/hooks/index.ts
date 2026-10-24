/**
 * Hook 机制 —— 统一出口
 *
 * 用法：
 *   import { getHookManager } from '../agent/hooks';
 *
 * 四个事件点见 types.ts 的说明。
 */

export {
  HOOK_EVENTS,
  BLOCKING_EVENTS,
  DEFAULT_HOOK_TIMEOUT_MS,
  MAX_STOP_BLOCKS,
} from './types';

export type {
  HookEvent,
  HookCommand,
  HookEntry,
  HooksFile,
  HookInvocation,
  HookOutcome,
} from './types';

export { runHookCommand } from './runner';
export type { HookRunResult } from './runner';

export {
  hookConfigPaths,
  loadHooksConfig,
  compileMatcher,
  entryMatches,
  entriesFor,
} from './config';
export type { LoadedHooks } from './config';

export {
  HookManager,
  getHookManager,
  resetHookManager,
  setBuiltinStopCheck,
} from './manager';
export type { BuiltinStopCheck } from './manager';
