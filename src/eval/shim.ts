/**
 * 评测环境的 vscode 垫片
 *
 * 为什么需要这个文件：
 * logger.ts 顶层就是 `import * as vscode from 'vscode'`，
 * 而 provider.ts 又 import 了 logger。
 * 所以只要跑真实 provider，就一定会 require('vscode')，
 * 在纯 Node 环境（不是 VS Code 里）直接抛 "Cannot find module 'vscode'"。
 *
 * 解决：劫持 Node 的模块解析，把 require('vscode') 换成这个内存 stub。
 *   必须在【任何 import vscode 的模块之前】执行，所以是第0 个被 require 的文件。
 *
 * 这不是造假：评测只用 agent 的核心能力（改文件、跑命令），
 * 绕开的是 VS Code 专有的 UI/编辑器依赖，不是被测逻辑本身。
 */

// ⭐ Module._resolveFilename 劫持
const Module = require('module');

/**
 * 解析 stub 模块路径。
 *
 * ⚠️ 这里必须同时兼容两种运行方式，路径后缀不一样：
 *   - vitest：用 vite 解析 .ts 源码，无后缀 require('./vscodeStub') 会解析失败
 *   - 编译后（node out/eval/cli.js）：文件是 vscodeStub.js，加 .ts 后缀会找不到
 *
 * 所以按顺序 try，第一个成功的就用它。
 */
function resolveStubPath(): string {
  const candidates = ['./vscodeStub.ts', './vscodeStub.js', './vscodeStub'];
  for (const c of candidates) {
    try {
      return require.resolve(c);
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error(
    `找不到 vscodeStub 模块，尝试过: ${candidates.join(', ')}` +
      `（当前文件: ${__filename}）`,
  );
}

const STUB_PATH = resolveStubPath();

if (!(global as any).__MINI_CODER_VSCODE_SHIM__) {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, ...args: any[]) {
    if (request === 'vscode') return STUB_PATH;
    return originalResolve.call(this, request, ...args);
  };
  (global as any).__MINI_CODER_VSCODE_SHIM__ = true;
}

// ⭐ 让 workspaceFolders 指向当前评测沙箱，
//   这样 paths.ts 的路径白名单才会把题目目录当成"工作区"，
//   否则 agent 写绝对路径会被自己的安全网拦下来（评测就白测了）。
let currentWorkspace: string | undefined;

let stubCache: any = null;

/** 拿到 stub 模块（走劫持后的解析，vitest / 编译后都一致） */
function stub(): any {
  if (!stubCache) stubCache = require(STUB_PATH);
  return stubCache;
}

export function setEvalWorkspace(dir: string | undefined): void {
  currentWorkspace = dir;
  stub().__setWorkspace(dir);
}

// 让被劫持的模块能看到最新值（clearLogs / getChannel 等会被用到）
export function getEvalLoggerChannel(): any {
  return stub().window.__lastChannel;
}