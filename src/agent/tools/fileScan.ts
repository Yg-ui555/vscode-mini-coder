/**
 * 文件遍历器 —— grep / glob / list_dir 三个工具共用
 *
 * 为什么单独抽一个模块：
 *   三个搜索工具都要做同一件事 —— 递归遍历目录、跳过垃圾目录、
 *   限制扫描规模、控制输出大小。这套逻辑如果各写一遍，三份代码会
 *   慢慢长歪（有的忘了跳 node_modules、有的忘了限流）。
 *   抽出来只有一份，改一次三个工具同时受益。
 *
 * 借鉴：nanobot 的 agent/tools/filesystem.py 里也做了同样的 ignore 目录收敛，
 *        但它用 Python 的 os.walk；这里用 Node 的 opendir（更快、不阻塞）。
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * 永远跳过的目录名
 *
 * ⚠️ 这些目录里有几十万个小文件（node_modules 动辄上万个包），
 *   不跳的话一次 grep 能扫十几万文件，直接卡死扩展。
 */
export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'out',
  'build',
  'dist-webview',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.idea',
  '.vscode-test',
  // 插件自己的运行时目录：agent 不该读写自己的存档
  '.mini-coder',
  '.notes',
]);

/**
 * 永远跳过的目录名（模式匹配）
 *
 * ⚠️ 为什么精确匹配不够 —— 2026-10-25 真实项目验证时当场抓到的：
 *   拿插件去审计一个真实的 Python 项目（同时存在 venv311 / venv_old
 *   两个虚拟环境），扫描 20000 文件的上限被【一个目录吃光】：
 *
 *     venv_old        19992 个文件（占 99.96%）
 *     真正的项目代码   一个都没扫到
 *
 *   而 venv_old / venv311 这种【带版本号】的目录名，
 *   IGNORED_DIRS 精确匹配一个都拦不住。
 *
 *   这不是理论问题 —— 它让「grep 全仓」直接失效，
 *   agent 只能靠 glob 手动绕开，浪费轮次还容易漏文件。
 *
 *   实测：修之前 agent 自己在探索时也踩到了，
 *   得主动说「venv 目录会造成干扰；我先只查看 src/ 目录」才绕过去。
 */
const IGNORED_DIR_PATTERNS: RegExp[] = [
  /^venv[\w.-]*$/i, // venv / venv311 / venv_old / venv3.11
  /^\.venv[\w.-]*$/i, // .venv / .venv311
  /^env$/i, // 传统 Python 虚拟环境目录名
  /^site-packages$/i,
  /^__pypackages__$/i,
  /^eggs$/i,
  /^\.tox$/i,
  /^\.nox$/i,
  /^target$/i, // Rust 构建产物
  /^vendor$/i, // PHP / Go 的第三方代码目录
];

/**
 * 判断一个目录名是否应该被跳过
 *
 * ⚠️ 调用方一律用这个函数，不要直接 IGNORED_DIRS.has() ——
 *   后者只认精确匹配，漏掉带版本号的虚拟环境目录。
 */
export function isIgnoredDirName(name: string): boolean {
  if (IGNORED_DIRS.has(name)) return true;
  for (const re of IGNORED_DIR_PATTERNS) {
    if (re.test(name)) return true;
  }
  return false;
}

/** 扫描的文件数量上限（兜底，防止超大仓库把扩展卡死） */
export const MAX_FILES_SCANNED = 20_000;

/** 单个文件读取上限（跳过二进制和超大文件） */
export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB

/** 单个文件名最大长度（Windows 260 字符限制的软性兜底） */
const MAX_PATH_LENGTH = 300;

export interface WalkEntry {
  /** 绝对路径 */
  abs: string;
  /** 相对 root 的路径，统一用 / 分隔（跨平台一致，LLM 更好读） */
  rel: string;
}

export interface WalkOptions {
  /** 遍历根目录（绝对路径） */
  root: string;
  /** 遇到目录时返回 true 才继续往下走（用于 glob 剪枝） */
  shouldDescend?: (relDir: string) => boolean;
  /** 单次遍历的时间预算（毫秒），超了就停并报 truncated */
  timeBudgetMs?: number;
}

export interface WalkResult {
  files: WalkEntry[];
  /** 是否因为超出预算/上限被截断 */
  truncated: boolean;
  /** 触发的停止原因 */
  reason?: string;
}

/**
 * 递归收集文件（不走符号链接，避免目录环）
 *
 * @returns 文件列表 + 是否被截断
 */
export function walkFiles(opts: WalkOptions): WalkResult {
  const { root, shouldDescend, timeBudgetMs = 5000 } = opts;
  const started = Date.now();
  const files: WalkEntry[] = [];

  if (!fs.existsSync(root)) {
    return { files, truncated: false };
  }

  let truncated = false;
  let reason: string | undefined;

  const stack: string[] = [root];

  while (stack.length > 0) {
    // 时间预算检查：宁可少给结果，也不能让扩展主线程卡住
    if (Date.now() - started > timeBudgetMs) {
      truncated = true;
      reason = `扫描超时（${timeBudgetMs}ms）`;
      break;
    }

    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // 权限不足 / 目录已被删除 —— 跳过，不中断整体遍历
      continue;
    }

    for (const entry of entries) {
      const name = entry.name;

      // 目录级忽略（必须用 isIgnoredDirName，精确匹配会漏掉 venv311 这类目录）
      if (isIgnoredDirName(name)) continue;

      const abs = path.join(dir, name);
      if (abs.length > MAX_PATH_LENGTH) continue;

      const rel = path.relative(root, abs).split(path.sep).join('/');

      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        // 不跟随符号链接：可能是环，也可能指向工作区外
        continue;
      }

      if (isDir) {
        if (shouldDescend && !shouldDescend(rel)) continue;
        stack.push(abs);
        continue;
      }

      if (!entry.isFile()) continue;

      files.push({ abs, rel });

      if (files.length >= MAX_FILES_SCANNED) {
        truncated = true;
        reason = `达到扫描上限 ${MAX_FILES_SCANNED} 个文件`;
        break;
      }
    }

    if (truncated) break;
  }

  return { files, truncated, reason };
}

/**
 * 判断文件是否值得做文本搜索
 *
 * 二进制文件（图片、编译产物、压缩包）如果当 UTF-8 读会读出乱码，
 * 既污染结果又拖慢速度，这里用扩展名 + 内容双重过滤。
 */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg', '.tiff',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac', '.mkv',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
  '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.pyd', '.node',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.pyc', '.pyo', '.wasm', '.bin', '.dat', '.db', '.sqlite',
]);

export function isBinaryPath(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** 读文件为文本；超过上限或读失败返回 null（调用方跳过） */
export function readTextSafe(abs: string): string | null {
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_FILE_BYTES) return null;

    const buf = fs.readFileSync(abs);
    // 内容里出现大量 NUL 字节 = 二进制
    if (buf.includes(0)) return null;

    return buf.toString('utf-8');
  } catch {
    return null;
  }
}

// glob 模式 → 正则
//
// ⚠️ 注意：本函数的文档示例故意放在【行注释】里而不是块注释里 ——
//   glob 模式里的 "双星号+斜杠" 这个字符序列会被 JS 解析成块注释的结束符，
//   写在 /** */ 里会提前闭合注释，导致整段代码语法错误（TS1109）。
//   这个坑非常隐蔽，务必保持这里的写法。
//
// 支持的语法（够用即可，不追求完整 glob）：
//   双星号  跨任意层目录（含零层）
//   单星号  单层内的任意字符（不跨斜杠）
//   问号    单个字符
//   {a,b}   或
//
// 例：src 目录下所有 ts → src + 双星号 + 斜杠 + 单星号 + .ts
//     任意深度的测试文件 → 双星号 + 斜杠 + 单星号 + .test.ts
export function globToRegExp(glob: string): RegExp {
  let re = '';
  let i = 0;
  const g = glob;

  while (i < g.length) {
    const c = g[i];

    if (c === '*') {
      // '**' → 跨层；单个 '*' → 不跨 '/'
      if (g[i + 1] === '*') {
        // 处理 '**/' —— 要求后面至少是 0 层或多层
        if (g[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
          continue;
        }
        re += '.*';
        i += 2;
        continue;
      }
      re += '[^/]*';
      i += 1;
      continue;
    }

    if (c === '?') {
      re += '[^/]';
      i += 1;
      continue;
    }

    if (c === '{') {
      const close = g.indexOf('}', i);
      if (close > i) {
        const inner = g.slice(i + 1, close);
        const alts = inner.split(',').map((s) => globToRegExp(s).source.replace(/^\^|\$$/g, ''));
        re += `(?:${alts.join('|')})`;
        i = close + 1;
        continue;
      }
    }

    // 其余字符按字面量转义
    re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }

  return new RegExp(`^${re}$`);
}

// 把「目录模式的 glob」翻译成「是否能继续下潜」的判断，用于剪枝。
//
// ── 剪枝的正确做法（2026-10-21 修过一个严重 bug）─────────────────
//
// 之前的错误实现：拿 glob 转成的正则去试目录名，匹配不上就剪掉。
// 后果非常严重 —— 模式是 "任意深度下的 .ts" 时，正则要求路径以 .ts 结尾，
// 于是 src/ 这种中间目录全部被剪掉，一个文件都扫不到，
// glob 直接返回"没有匹配"。
//
// 正确且保守的规则：只有当 glob 开头有一段【不含通配符的字面前缀】时才能剪枝。
//   有前缀：src/xxx  -> 前缀 src，src 之外的目录必然不可能命中，可以不进
//   无前缀：xxx（以 * 或 ? 或 { 开头）-> 什么都可能命中，一个都不能剪
//
// 宁可多扫几个目录，也不要漏文件 —— 漏文件的症状（"搜不到"）极具误导性，
// 会让 LLM 以为代码里根本没有那段逻辑，然后顺着错误假设一路改下去。
export function makeDescendPredicate(globPattern?: string): ((relDir: string) => boolean) | undefined {
  if (!globPattern) return undefined;

  // 找到第一个通配符之前的那段字面前缀
  const firstWildcard = globPattern.search(/[*?{]/);
  const literalPrefix = firstWildcard === -1 ? globPattern : globPattern.slice(0, firstWildcard);
  const prefix = literalPrefix.replace(/\/+$/, '');

  // 没有字面前缀 -> 不剪枝
  if (!prefix) return undefined;

  return (relDir: string) => {
    if (!relDir) return true;
    return relDir === prefix || relDir.startsWith(prefix + '/');
  };
}

