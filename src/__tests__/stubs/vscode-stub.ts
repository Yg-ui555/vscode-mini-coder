/**
 * vscode 模块 stub - 给测试用
 *
 * 为什么需要：
 * - src/slashCommands/registry.ts 链式依赖 features/autoTest 等都 import vscode
 * - 测试环境跑在 Node 里，vscode 模块不存在
 * - vitest alias 把 'vscode' 指向这个 stub
 *
 * 实现：空对象 + 所有 API 调用静默返回 undefined
 */

export const workspace = {
  workspaceFolders: undefined,
  getConfiguration: () => ({ get: () => undefined }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
  createFileSystemWatcher: () => ({
    onDidChange: () => {},
    onDidCreate: () => {},
    onDidDelete: () => {},
    dispose: () => {},
  }),
  openTextDocument: () => Promise.reject(new Error('stub')),
  getWorkspaceFolder: () => undefined,
  isVirtualWorkspace: false,
};

export const window = {
  showInformationMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  showInputBox: () => Promise.resolve(''),
  showQuickPick: () => Promise.resolve(undefined),
  createWebviewPanel: () => {
    throw new Error('stub: cannot create webview panel in test');
  },
  activeTextEditor: undefined,
};

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: () => Promise.resolve(undefined),
};

export const env = {
  clipboard: { writeText: () => Promise.resolve() },
};

export const Uri = {
  joinPath: (...parts: any[]) => ({ fsPath: parts.map((p: any) => p.fsPath || p).join('/') }),
  file: (p: string) => ({ fsPath: p }),
};

export const ViewColumn = {
  Beside: 2,
  One: 1,
  Two: 2,
};

export const ProgressLocation = {
  Notification: 15,
  Window: 10,
};

export const ExtensionContext = class {} as any;

export default {
  workspace,
  window,
  commands,
  env,
  Uri,
  ViewColumn,
  ProgressLocation,
  ExtensionContext,
};