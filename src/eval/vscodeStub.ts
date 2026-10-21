/**
 * vscode 模块的内存替身（评测专用）
 *
 * 只实现被测链路真正会碰到的 API，其余一律返回 undefined。
 * 原则：宁可少实现，也不要假装实现了——
 * 一个返回 undefined 但被静默吞掉的调用，比一个明确抛错的调用危险。
 */

// workspaceFolders 可被运行时改写（每道题指向自己的沙箱）
let workspaceFolders: Array<{ uri: { fsPath: string }; name: string; index: number }> | undefined;

export function __setWorkspace(dir: string | undefined): void {
  workspaceFolders = dir
    ? [{ uri: { fsPath: dir }, name: 'eval-sandbox', index: 0 }]
    : undefined;
}

// ─────── window ───────
let lastChannel: any = null;

export const window = {
  /** logger 用它接日志；评测里我们把它收集起来写进 trace */
  createOutputChannel(_name: string) {
    lastChannel = {
      name: _name,
      lines: [] as string[],
      appendLine(line: string) {
        this.lines.push(line);
      },
      clear() {
        this.lines = [];
      },
      show() {},
      hide() {},
      dispose() {},
      replace() {},
      __lastChannel: null,
    };
    return lastChannel;
  },
  get __lastChannel() {
    return lastChannel;
  },
  // 评测里"用户"永远不点任何按钮 —— 返回 undefined 表示取消
  showInformationMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  showInputBox: () => Promise.resolve(undefined),
  showQuickPick: () => Promise.resolve(undefined),
  createWebviewPanel: () => {
    throw new Error('[eval] 评测环境不支持 webview');
  },
  activeTextEditor: undefined,
  withProgress: (_opts: any, task: any) => Promise.resolve(task({ report: () => {} }, {})),
  showTextDocument: () => Promise.reject(new Error('[eval] 不支持')),
};

// ─────── workspace ───────
export const workspace = {
  get workspaceFolders() {
    return workspaceFolders;
  },
  getConfiguration: () => ({ get: (_k: string, d?: any) => d }),
  onDidChangeConfiguration: () => ({ dispose() {} }),
  createFileSystemWatcher: () => ({
    onDidChange: () => {},
    onDidCreate: () => {},
    onDidDelete: () => {},
    dispose: () => {},
  }),
  openTextDocument: () => Promise.reject(new Error('[eval] 不支持')),
  getWorkspaceFolder: () => workspaceFolders?.[0],
  isVirtualWorkspace: false,
  fs: undefined,
};

// ─────── 命令 / 环境变量 ───────
export const commands = {
  registerCommand: () => ({ dispose() {} }),
  executeCommand: () => Promise.resolve(undefined),
};

export const env = {
  clipboard: { writeText: () => Promise.resolve() },
  appName: 'Mini-Coder Eval (shim)',
};

export const Uri = {
  joinPath: (base: any, ...parts: string[]) => ({
    fsPath: [base?.fsPath ?? base, ...parts].join('\\'),
  }),
  file: (p: string) => ({ fsPath: p }),
  parse: (p: string) => ({ fsPath: p }),
};

export const ViewColumn = { Beside: 2, One: 1, Two: 3 };
export const ProgressLocation = { Notification: 15, Window: 10, SourceControl: 1 };
export const ExtensionContext = class {} as any;
export const ExtensionMode = { Production: 1, Development: 2, Test: 3 };

export default {
  workspace,
  window,
  commands,
  env,
  Uri,
  ViewColumn,
  ProgressLocation,
  ExtensionContext,
  ExtensionMode,
  __setWorkspace,
};