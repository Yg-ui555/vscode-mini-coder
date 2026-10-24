/**
 * 敏感信息脱敏 —— 2026-10-25 真实项目验证时补的一层防线
 *
 * ⭐ 起因（真实踩坑，不是假想）：
 *   拿插件审一个真实项目时，agent 读了 `.env`，
 *   把里面的真实 API Key（`sk-xxx`）**原样写进了体检报告**。
 *   报告是要给人看的、可能要转发的 —— 密钥一旦进了报告就是泄露。
 *
 *   而且这跟插件自己的价值观是矛盾的：
 *   prompt 快照测试里有一条硬断言「绝不能出现 API Key」，
 *   但那管的是 system prompt，**管不到工具读回来的内容**。
 *
 * ─────────────────────────────────────────────────────────
 * 为什么是【脱敏】而不是【拦截】
 *
 *   直接拒绝读 `.env` 会让一类很常见的任务做不了：
 *   「这个项目配了哪些环境变量」「EMBED_BASE_URL 在 .env 里配了没」
 *   「.env 里有没有开某个开关」—— agent 看得见【结构】才能回答。
 *
 *   所以：
 *     · 变量名、结构、注释、布尔开关、URL → 原样保留，agent 照常能用
 *     · 密钥值 → 替换成 ***REDACTED***
 *
 * ⚠️ 脱敏是【减少泄露面】，不是【保证不泄露】：
 *   自定义格式的密钥未必认得出来。
 *   真正的防线仍然是 —— 别把密钥提交进版本库。
 */

import * as path from 'path';

/* ────────────── 哪些文件算「敏感文件」 ────────────── */

/** 文件名 / 后缀命中即视为敏感文件 */
const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i, // .env / .env.local / .env.production
  /\.(pem|key|p12|pfx|keystore|jks|asc|gpg)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^(credentials|secrets|service[-_]?account)[^/]*\.(json|ya?ml)$/i,
  /^\.?(netrc|npmrc|pypirc|dockercfg)$/i,
];

/** 例外：模板 / 样例文件里没有真实密钥，放行 */
const SENSITIVE_EXCEPTIONS: RegExp[] = [
  /\.example$/i,
  /\.sample$/i,
  /\.template$/i,
  /\.dist$/i,
];

/** 判断一个路径是不是敏感文件（只看文件名，不看目录） */
export function isSensitiveFile(filePath: string): boolean {
  const base = path.basename(filePath);
  for (const ex of SENSITIVE_EXCEPTIONS) {
    if (ex.test(base)) return false;
  }
  return SENSITIVE_FILE_PATTERNS.some((re) => re.test(base));
}

/* ────────────── 密钥值的字面量模式（对所有文件生效） ────────────── */

/**
 * 这些格式足够独特，误伤正常代码的概率极低。
 * 即使文件本身不是敏感文件，正文里的硬编码密钥也会被脱敏。
 */
const SECRET_LITERAL_PATTERNS: RegExp[] = [
  // DeepSeek / OpenAI / Anthropic / Moonshot / 智谱 / Groq …
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  // Google API
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  // AWS Access Key ID
  /\bAKIA[A-Z0-9]{16}\b/g,
  // GitHub token
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  // Slack token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // 整块私钥
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/* ────────────── key=value 形式（只在敏感文件里生效） ────────────── */

/**
 * 形如 `KEY=xxx` / `export TOKEN: "xxx"` / `password = xxx`。
 * 变量名里含 KEY / TOKEN / SECRET / PASSWORD 这类词才处理，
 * 免得把 `MAX_TOKENS=8000` 这种配置也涂掉。
 */
const KEY_VALUE_PATTERN =
  /^(\s*(?:export\s+)?[A-Za-z0-9_.-]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|DSN)[A-Za-z0-9_.-]*\s*[:=]\s*)(.*)$/gim;

/** 明显不是密钥的值 —— 保留原样 */
const PLACEHOLDER_VALUES = new Set([
  'true',
  'false',
  'null',
  'none',
  'nil',
  '""',
  "''",
  '',
  'yes',
  'no',
  'on',
  'off',
  'changeme',
  'change_me',
  'placeholder',
  'your_key_here',
  'your_token_here',
  'xxxxx',
  'todo',
]);

/** 值看起来像占位符（全是 x / * / <...> / ${...}） */
function looksLikePlaceholder(value: string): boolean {
  const v = value.trim().replace(/^["']|["']$/g, '').trim();
  if (PLACEHOLDER_VALUES.has(v.toLowerCase())) return true;
  if (/^[x*<>]{3,}$/i.test(v)) return true;
  // ${ENV_VAR} 形式 —— 是引用不是字面量
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(v)) return true;
  return false;
}

/* ────────────── 主入口 ────────────── */

export interface RedactResult {
  content: string;
  /** 脱敏了几处 */
  count: number;
  /** 这个文件是不是敏感文件（只影响 key=value 那条规则） */
  sensitiveFile: boolean;
}

const REDACTED = '***REDACTED***';

/**
 * 对内容做脱敏
 *
 * @param content  原始内容
 * @param filePath 文件路径（用来判断是不是敏感文件）
 */
export function redactContent(
  content: string,
  filePath: string,
  forceSensitive = false,
): RedactResult {
  const sensitiveFile = forceSensitive || isSensitiveFile(filePath);
  let count = 0;
  let out = content;

  // 规则 1：字面量密钥格式（对所有文件生效）
  for (const re of SECRET_LITERAL_PATTERNS) {
    out = out.replace(re, () => {
      count++;
      return REDACTED;
    });
  }

  // 规则 2：key=value 形式（只对敏感文件生效）
  if (sensitiveFile) {
    out = out.replace(KEY_VALUE_PATTERN, (_m, prefix: string, value: string) => {
      if (looksLikePlaceholder(value)) return _m;
      // 值太短的基本不可能是密钥，留着（免得把 `PORT=80` 也涂了）
      const raw = value.trim();
      if (raw.replace(/^["']|["']$/g, '').trim().length < 8) return _m;
      count++;
      return `${prefix}${REDACTED}`;
    });
  }

  return { content: out, count, sensitiveFile };
}

/**
 * 命令行里是否涉及敏感文件（给 run_shell 用）
 *
 * 例：`cat .env` / `type .env.local` / `Get-Content .env.production`
 * 这类命令的输出里往往带着 key=value 形式的密钥，
 * 光靠字面量规则（sk-xxx 那种）不一定认得出来。
 */
export function commandTouchesSensitiveFile(command: string): boolean {
  if (!command) return false;
  const tokens = command.split(/[\s;|&><'"()[\]]+/).filter(Boolean);
  for (const t of tokens) {
    if (isSensitiveFile(t)) return true;
  }
  return false;
}

/**
 * 给「已经脱敏过的内容」加一句提示，让 agent 知道这里有东西被涂掉了
 *
 * ⚠️ 不能不说 —— 不说的话 agent 会以为文件里本来就没值，
 * 从而给出「这个 key 没配」的错误结论。
 */
export function redactionNotice(count: number): string {
  if (count <= 0) return '';
  return (
    `\n\n[🔒 敏感信息已脱敏：${count} 处密钥值被替换为 ${REDACTED}。` +
    `这是安全策略，不是文件内容本来就是这样。` +
    `如果你需要知道具体配置，请让用户提供，或建议用户自己查看该文件。]`
  );
}
