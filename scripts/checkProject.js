#!/usr/bin/env node
/**
 * 项目自检 —— 把"已经踩过的坑"变成 CI 里能自动发现的失败
 *
 * ⭐ 为什么要写这个文件
 *
 *   2026-10-22 修过一个真实的 bug：package.json 的 provider 枚举里写了
 *   `anthropic`，但代码里根本没实现这个 provider。
 *   → 用户在设置界面选了 Claude，代码判定不合法 → 【静默丢弃】→ 回落 DeepSeek
 *   → 用户以为在用 Claude，账单却出在 DeepSeek 上，而且【没有任何报错】。
 *
 *   修的时候在 package.json 里写了一段注释提醒"两边要同步"：
 *     > 改这份 enum 时请同步改 `src/config.ts` 的 `PROVIDER_CONFIGS`，
 *     > 两边不一致就会出现同样的静默失效。
 *
 *   ⭐ 但"写个注释提醒"是【最弱】的守卫 —— 下一个人（或者三个月后的自己）
 *     一样会忘。这份脚本就是那道【真】守卫。
 *
 *   同样的思路适用于下面所有 7 项检查：
 *   它们全都对应一个"已经发生过、或迟早会发生"的坑。
 *
 * ─────────────────────────────────────────────────────────────
 * 运行方式
 *
 *   node scripts/checkProject.js
 *
 *   退出码：0 = 全过；1 = 有 ERROR（CI 应当红）
 *   WARNING 只会打印，不影响退出码。
 *
 *   纯 Node 实现，零依赖，不需要先 tsc —— 所以在 CI 里可以放在
 *   最前面跑，秒出结果。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const EVAL = path.join(ROOT, 'eval');

const errors = [];
const warnings = [];
const notes = [];

function err(check, msg) {
  errors.push(`[${check}] ${msg}`);
}
function warn(check, msg) {
  warnings.push(`[${check}] ${msg}`);
}
function note(check, msg) {
  notes.push(`[${check}] ${msg}`);
}

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}
function readJson(rel) {
  return JSON.parse(readText(rel));
}
function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════
 * 1. provider 名单同步
 *
 * 单一真相源是 src/config.ts 的 PROVIDER_CONFIGS；
 * package.json 的 enum 是它的【投影】，必须完全一致。
 * ═══════════════════════════════════════════════════════════════ */
function checkProviderEnum() {
  const CHECK = 'provider-enum';
  const pkg = readJson('package.json');
  const cfg = readText('src/config.ts');

  // 从 PROVIDER_CONFIGS 对象体里抠出 key
  const m = cfg.match(/PROVIDER_CONFIGS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!m) {
    err(CHECK, '在 src/config.ts 里找不到 PROVIDER_CONFIGS 定义（格式变了？）');
    return;
  }
  const srcKeys = [...m[1].matchAll(/^\s{2}([A-Za-z0-9_]+):\s*\{/gm)].map((x) => x[1]);

  const props = pkg.contributes?.configuration?.properties ?? {};
  const providerProp = props['mini-coder.provider'];
  if (!providerProp) {
    err(CHECK, "package.json 里找不到 mini-coder.provider 配置项");
    return;
  }
  const pkgKeys = providerProp.enum ?? [];

  const srcSet = new Set(srcKeys);
  const pkgSet = new Set(pkgKeys);

  for (const k of srcKeys) {
    if (!pkgSet.has(k)) {
      err(
        CHECK,
        `src/config.ts 的 PROVIDER_CONFIGS 里有 "${k}"，但 package.json 的 enum 里没有。` +
          `→ 用户在设置界面选不到它 / 或者选了会被静默丢弃。`,
      );
    }
  }
  for (const k of pkgKeys) {
    if (!srcSet.has(k)) {
      err(
        CHECK,
        `⭐ package.json 的 enum 里有 "${k}"，但 src/config.ts 里【没有实现】。` +
          `→ 用户选了它会被静默丢弃并回落到默认 provider —— 这就是 2026-10-22 修过的那个 bug。`,
      );
    }
  }
  if (srcKeys.length === pkgKeys.length && [...srcKeys].sort().join() === [...pkgKeys].sort().join()) {
    note(CHECK, `provider 名单一致（${srcKeys.length} 个：${srcKeys.join(', ')}）`);
  }
}

/* ═══════════════════════════════════════════════════════════════
 * 2. 工具注册表 vs ALL_TOOL_NAMES
 *
 * factory.ts 是"有哪些工具"的唯一真相源，ALL_TOOL_NAMES 是给 /doctor 用的名单。
 * 两边不一致 → 自检说"工具齐了"但实际缺一个，或者反过来。
 * ═══════════════════════════════════════════════════════════════ */
function checkToolRegistry() {
  const CHECK = 'tool-registry';
  const factorySrc = readText('src/agent/tools/factory.ts');

  // register(new XxxTool())
  const registered = [...factorySrc.matchAll(/register\(new\s+(\w+)\(\)\)/g)].map((m) => m[1]);

  // 从每个工具类里读出 readonly name = 'xxx'
  const toolFiles = listFiles(path.join(SRC, 'agent', 'tools'))
    .filter((f) => f.endsWith('.ts') && !f.includes('__tests__'))
    .map((f) => ({ file: f, src: fs.readFileSync(f, 'utf-8') }));

  const classToName = new Map();
  for (const { file, src } of toolFiles) {
    for (const cm of src.matchAll(/export class\s+(\w+)\s+implements\s+Tool\b/g)) {
      // 在这个类里找 readonly name = '...'
      const body = src.slice(cm.index);
      const nm = body.match(/readonly\s+name\s*=\s*['"]([^'"]+)['"]/);
      if (nm) classToName.set(cm[1], nm[1]);
    }
  }

  const registeredNames = registered.map((c) => classToName.get(c)).filter(Boolean);

  // ReadOnlyToolNames（meta.ts）
  //
  // ⚠️ 必须【先声明】再用 —— 下面 allNames 的循环里要用它。
  //   第一版把它写在后面，const 声明有暂时性死区（TDZ），
  //   脚本直接崩成 "Cannot access 'readOnlyNames' before initialization"。
  const metaSrc = readText('src/agent/tools/meta.ts');
  const rm = metaSrc.match(/export const ReadOnlyToolNames\s*=\s*\[([\s\S]*?)\]\s*as const;/);
  const readOnlyNames = rm ? [...rm[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];

  // ALL_TOOL_NAMES
  const am = factorySrc.match(/export const ALL_TOOL_NAMES\s*=\s*\[([\s\S]*?)\];/);
  if (!am) {
    err(CHECK, '在 factory.ts 里找不到 ALL_TOOL_NAMES');
    return;
  }
  // ⚠️ 这个数组用了展开语法 `...ReadOnlyToolNames`，
  //    只抠字符串会漏掉前 4 个 —— 2026-10-26 自检脚本第一版就踩了这个坑。
  const allNames = [];
  for (const line of am[1].split('\n')) {
    if (line.includes('...ReadOnlyToolNames')) {
      allNames.push(...readOnlyNames);
      continue;
    }
    for (const m of line.matchAll(/'([^']+)'/g)) allNames.push(m[1]);
  }

  const regSet = new Set(registeredNames);
  const allSet = new Set(allNames);

  for (const n of allNames) {
    if (!regSet.has(n)) {
      err(CHECK, `ALL_TOOL_NAMES 里有 "${n}"，但 factory.ts 并没有注册它 → /doctor 会误报`);
    }
  }
  for (const n of registeredNames) {
    if (!allSet.has(n)) {
      err(CHECK, `factory.ts 注册了 "${n}"，但 ALL_TOOL_NAMES 里没有 → /doctor 看不到这个工具`);
    }
  }
  for (const n of readOnlyNames) {
    if (!regSet.has(n)) {
      err(CHECK, `ReadOnlyToolNames 里有 "${n}"，但没被注册 → 权限分级会误判`);
    }
  }
  if (!errors.some((e) => e.startsWith(`[${CHECK}]`))) {
    note(CHECK, `工具名单一致（注册 ${registeredNames.length} 个，只读 ${readOnlyNames.length} 个）`);
  }
}

/* ═══════════════════════════════════════════════════════════════
 * 3. 单文件行数上限 —— 防"大泥球"
 *
 * 本项目曾有一个 1075 行的 agent/loop.ts。
 * 它能跑，但它已经是个"什么都往里塞"的黑洞：加任何新功能都要在它里面找地方。
 * 管线化改造（ROADMAP_V2 Phase 4）的目标就是把它拆开。
 *
 * 这个上限是【回归守卫】：拆完之后，谁再往回堆，这个检查会拦住。
 * ═══════════════════════════════════════════════════════════════ */
const MAX_FILE_LINES = 800;

function checkFileSize() {
  const CHECK = 'file-size';
  const files = listFiles(SRC).filter(
    (f) => f.endsWith('.ts') && !f.includes(`${path.sep}__tests__${path.sep}`),
  );
  let worst = { lines: 0, rel: '' };
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf-8').split('\n').length;
    if (lines > worst.lines) worst = { lines, rel: path.relative(ROOT, f).replace(/\\/g, '/') };
    if (lines > MAX_FILE_LINES) {
      err(
        CHECK,
        `${path.relative(ROOT, f).replace(/\\/g, '/')} 有 ${lines} 行，超过上限 ${MAX_FILE_LINES}。` +
          `→ 说明有职责没拆出去。参考 docs/archive/ROADMAP_V2.md「Phase 4：主循环管线化」的做法。`,
      );
    }
  }
  if (!errors.some((e) => e.startsWith(`[${CHECK}]`))) {
    note(CHECK, `所有源文件都在 ${MAX_FILE_LINES} 行以内（最大：${worst.rel} ${worst.lines} 行）`);
  }
}

/* ═══════════════════════════════════════════════════════════════
 * 3. MCP 工具命名规范
 *
 * MCP 工具是【运行时注册】的（服务器起来了才有），
 * 所以它们不在 ALL_TOOL_NAMES 里 —— 那是内置工具的名单。
 *
 * 但命名规范必须守住：mcp__<服务器名>__<工具名>
 *
 * 为什么重要：
 *   · 防重名 —— 两个 MCP 服务器都可能提供 read_file
 *   · 模型能看出工具来自哪个服务器
 *   · resolveAlias() 靠命名空间把模型写错的名字纠正回来
 *     （而且【前缀是信任边界】：mcp__ 前缀的工具一律按"外部程序"处理，
 *      不会因为名字像内置只读工具就被自动放行）
 *
 * 教训（2026-10-27 接入 MCP 时踩的）：
 *   resolveAlias() 里那个"带命名空间前缀"的分支本来是【坏的】——
 *   它拿规范化后的 key 去 split('__')，而规范化已经把下划线去掉了，
 *   所以永远切不开。已修（registry.ts）。
 * ═══════════════════════════════════════════════════════════════ */
function checkMcpNaming() {
  const CHECK = 'mcp-naming';

  const mcpToolSrc = readText('src/agent/mcp/mcpTool.ts');
  const mcpDir = path.join(SRC, 'agent', 'mcp');

  // MCP 工具名必须由 mcp__<server>__<tool> 拼出来
  if (!/mcp__\$\{serverName\}__/.test(mcpToolSrc)) {
    err(
      CHECK,
      'src/agent/mcp/mcpTool.ts 里没有找到 mcp__${serverName}__ 的命名拼接。' +
        '→ MCP 工具名必须带命名空间，否则会和内置工具重名、且失去信任边界。',
    );
  }

  // MCP 工具不能进 ALL_TOOL_NAMES（那是内置工具的静态名单）
  const factorySrc = readText('src/agent/tools/factory.ts');
  const allNamesBlock = factorySrc.slice(
    factorySrc.indexOf('export const ALL_TOOL_NAMES'),
  );
  if (/mcp__/.test(allNamesBlock)) {
    err(
      CHECK,
      'ALL_TOOL_NAMES 里出现了 mcp__ —— MCP 工具是运行时动态注册的，' +
        '不该出现在内置工具的静态名单里。',
    );
  }

  // MCP 模块的每个文件都要在 800 行上限内（复用 file-size 的判定标准）
  if (fs.existsSync(mcpDir)) {
    for (const f of listFiles(mcpDir).filter((x) => x.endsWith('.ts'))) {
      const lines = fs.readFileSync(f, 'utf-8').split('\n').length;
      if (lines > MAX_FILE_LINES) {
        err(
          CHECK,
          `${path.relative(ROOT, f).replace(/\\/g, '/')} 有 ${lines} 行，超过上限 ${MAX_FILE_LINES}。`,
        );
      }
    }
  }

  if (!errors.some((e) => e.startsWith(`[${CHECK}]`))) {
    note(CHECK, 'MCP 工具命名规范正确（mcp__<server>__<tool>）');
  }
}

/* ═══════════════════════════════════════════════════════════════
 * 4. .vscodeignore 排除项完整
 *
 * vsce 只读 .vscodeignore，不读 .gitignore。
 * 曾经 .gitignore 排除了 eval/results.json，.vscodeignore 没排，
 * 结果 280KB 评测产物 + 150KB 基线被塞进发给用户的 VSIX。
 * ═══════════════════════════════════════════════════════════════ */
function checkVscodeignore() {
  const CHECK = 'vscodeignore';
  const ig = readText('.vscodeignore');
  const required = ['eval/**', 'webview-ui/**', 'src/**'];
  for (const r of required) {
    if (!ig.includes(r)) {
      err(CHECK, `.vscodeignore 缺少 "${r}" → 打包会把不该给用户的东西塞进 VSIX`);
    }
  }
  // 必须保留的
  for (const keep of ['!skills/**', '!dist-webview/**']) {
    if (!ig.includes(keep)) {
      err(CHECK, `.vscodeignore 缺少 "${keep}" → 内置技能包 / webview 产物会被漏掉，插件装完不能用`);
    }
  }
  if (!errors.some((e) => e.startsWith(`[${CHECK}]`))) {
    note(CHECK, '.vscodeignore 排除项与保留项都齐全');
  }
}

/* ═══════════════════════════════════════════════════════════════
 * 5. 每道评测题都要有标准答案（oracle）
 *
 * ⭐ 这是"废题防线"。
 *
 *   一道题如果连人写的标准答案都过不了断言，那它就不是难题，是废题。
 *   而废题会以【满分率下降】的形式混进评测集 —— 你看到数字掉了，
 *   第一个反应是"模型变差了"，去调提示词换模型，
 *   全在错误的方向上使劲。
 *
 *   第四条铁律（"这道题有解"）只能靠 oracle 来查。
 * ═══════════════════════════════════════════════════════════════ */
function checkEvalOracles() {
  const CHECK = 'eval-oracle';
  const tasksDir = path.join(EVAL, 'tasks');
  const oracleDir = path.join(EVAL, 'oracles');
  if (!fs.existsSync(tasksDir)) {
    err(CHECK, '找不到 eval/tasks 目录');
    return;
  }
  const oracles = new Set(
    fs.existsSync(oracleDir)
      ? fs.readdirSync(oracleDir).filter((f) => f.endsWith('.solution.js')).map((f) => f.replace('.solution.js', ''))
      : [],
  );

  const missing = [];
  const taskDirs = fs
    .readdirSync(tasksDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d\d-/.test(d.name))
    .map((d) => d.name)
    .sort();

  for (const t of taskDirs) {
    // 题目结构
    for (const f of ['task.md', 'check.js']) {
      if (!fs.existsSync(path.join(tasksDir, t, f))) {
        err(CHECK, `${t} 缺少 ${f}`);
      }
    }
    if (!fs.existsSync(path.join(tasksDir, t, 'initial'))) {
      err(CHECK, `${t} 缺少 initial/ 目录（agent 没有初始代码可改）`);
    }
    if (!oracles.has(t)) {
      missing.push(t);
    }
  }

  if (missing.length > 0) {
    err(
      CHECK,
      `有 ${missing.length} 道题没有标准答案（eval/oracles/<题号>.solution.js）：\n` +
        `        ${missing.join('\n        ')}\n` +
        `        → 没有 oracle 的题无法证明"有解"，可能是废题。` +
        `跑 \`npm run eval:solvable\` 可以验证已有 oracle 是否真的能过全部断言。`,
    );
  } else {
    note(CHECK, `${taskDirs.length} 道题全部有标准答案`);
  }
}

/* ═══════════════════════════════════════════════════════════════
 * 6. 源码里不能出现疑似真实的 API Key
 *
 * 本地 .env 里有真 key（已 gitignore）。但万一有人把 key 写进了源码、
 * 写进了测试夹具、或者粘进了注释 —— 提交上去就是泄露。
 *
 * 真正防泄露的是 gitignore + 平台密钥扫描，这个检查是【兜底】：
 * 专门抓"看起来像 key 的长随机串"。
 * ═══════════════════════════════════════════════════════════════ */
const SECRET_PATTERNS = [
  { re: /\bsk-[A-Za-z0-9]{24,}\b/g, name: 'OpenAI 风格 key (sk-...)' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, name: 'AWS Access Key' },
  { re: /\bghp_[A-Za-z0-9]{30,}\b/g, name: 'GitHub token' },
];

/**
 * ⭐ 逃逸机制：行内加 `guard:allow-secret` 注释可以豁免这一行
 *
 *   为什么需要它：脱敏层自己的单元测试（src/__tests__/tools/redact.test.ts）
 *   必须包含"看起来像真 key 的假 key"，否则测不了脱敏逻辑。
 *   这些假 key 是【故意】长成那样的。
 *
 *   但豁免必须是【显式】的 —— 写代码的人得亲手写这个标记，
 *   不能让整份文件自动跳过（那样就等于这个检查形同虚设）。
 */
const ALLOW_MARKER = 'guard:allow-secret';

function checkNoSecrets() {
  const CHECK = 'no-secret';
  const files = listFiles(SRC).filter((f) => f.endsWith('.ts'));
  let found = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf-8');
    for (const { re, name } of SECRET_PATTERNS) {
      re.lastIndex = 0;
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(ALLOW_MARKER)) continue;
        re.lastIndex = 0;
        const hits = line.match(re);
        if (hits) {
          err(
            CHECK,
            `${path.relative(ROOT, f).replace(/\\/g, '/')}:${i + 1} 出现了疑似真实密钥（${name}）：` +
              `${hits[0].slice(0, 8)}…\n        → 如果这是真 key，立刻去平台吊销它。` +
              `（确实是测试用的假 key 就在这一行加注释 ${ALLOW_MARKER}）`,
          );
          found++;
        }
      }
    }
  }
  if (found === 0) {
    note(CHECK, '源码里没有疑似真实密钥');
  }
}

/* ═══════════════════════════════════════════════════════════════
 * 7. package.json 与源文件的 provider/model 默认值不能漂移
 *
 * limits.ts 的存在理由就是这个：max_iterations 曾经在三处各写各的
 * （loop.ts 写 30、panel.ts 写 20、context.ts 告诉 LLM 是 30），
 * 结果 LLM 以为有 30 轮预算、实际只有 20。
 * ═══════════════════════════════════════════════════════════════ */
function checkNoDrift() {
  const CHECK = 'no-drift';
  const limits = readText('src/agent/limits.ts');
  const pkg = readJson('package.json');

  const m = limits.match(/export const MAX_ITERATIONS\s*=\s*(\d+)/);
  if (!m) {
    err(CHECK, '在 src/agent/limits.ts 里找不到 MAX_ITERATIONS');
    return;
  }
  const maxIterations = Number(m[1]);

  // panel.ts 必须用常量，不能写死数字
  const panel = readText('src/webview/panel.ts');
  const hardcoded = [...panel.matchAll(/new AgentLoop\([^)]*?,\s*(\d+)\s*,/g)].map((x) => Number(x[1]));
  for (const n of hardcoded) {
    if (n !== maxIterations) {
      err(
        CHECK,
        `panel.ts 里 AgentLoop 的迭代上限写死了 ${n}，但 limits.ts 的常量是 ${maxIterations}。` +
          `→ LLM 拿到的预算和真实预算对不上，规划会跑偏。`,
      );
    }
  }
  note(CHECK, `迭代上限单一真相源 = ${maxIterations}`);
}

/* ═══════════════════════════════════════════════════════════════
 * 9. GitHub Actions workflow 文件的上下文合法性
 *
 * ⭐ 这一项是被 2026-10-28 的真实事故逼出来的。
 *
 *   事故经过：
 *     · 仓库从建仓起 CI 徽章就是红的，但 Actions 页面点进去显示 "0 jobs"。
 *     · GitHub 的原始报错（藏在 Annotations 里）：
 *         Invalid workflow file: .github/workflows/ci.yml
 *         (Line: 149, Col: 9): Unrecognized named-value: 'secrets'.
 *         Located at position 40 within expression:
 *           github.event_name != 'pull_request' || secrets.DEEPSEEK_API_KEY != ''
 *
 *   根因（官方 contexts availability 表）：
 *     job 级 if 的可用上下文只有 github / needs / vars / inputs，
 *     【secrets 不在其中】。
 *     → 不是"表达式写错了"，是"这个位置根本拿不到 secret"。
 *     → 后果不是某一个 job 挂掉，而是【整个 workflow 文件解析失败】，
 *       一个 job 都不会被创建 → 徽章永远红，而且【日志里什么都没有】。
 *
 *   为什么"日志里什么都没有"最可怕：
 *     Actions 页面显示 Failure，但点进去 0 个 job，看不到任何一行日志。
 *     面试官点开你的仓库看到红叉，也不会给你时间解释。
 *
 *   这项检查防的就是这一类【静默失效】：
 *     ① if 表达式里出现 secrets 上下文（job 级 / step 级都不允许）
 *     ② 触发分支名和远端实际分支对不上
 *        —— 这个坑也踩过一次（写 main，远端其实是 master），
 *           后果同样是"CI 永远不触发"，但没有任何报错。
 * ═══════════════════════════════════════════════════════════════ */
function checkWorkflowContexts() {
  const CHECK = 'workflow-context';
  const wfDir = path.join(ROOT, '.github', 'workflows');
  const files = listFiles(wfDir).filter((f) => /\.ya?ml$/.test(f));

  if (files.length === 0) {
    warn(CHECK, '没找到 .github/workflows/ 下的任何 yml —— CI 可能被删了');
    return;
  }

  /* ── ① if 表达式不得使用 secrets 上下文 ────────────────────── */
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const lines = fs.readFileSync(f, 'utf-8').split('\n');
    lines.forEach((line, i) => {
      // 只看真正的 if: 键 —— 注释行以 # 开头，不会匹配
      if (!/^\s*if:/.test(line)) return;
      if (!/\bsecrets\./.test(line)) return;
      err(
        CHECK,
        `${rel}:${i + 1} 的 if 表达式里用了 secrets 上下文。` +
          `→ GitHub 会拒绝加载【整个 workflow 文件】（Unrecognized named-value: 'secrets'），` +
          `一个 job 都不会创建，徽章永远红且没有任何日志。\n` +
          `        修法：if 里只能用 github / needs / vars / inputs；` +
          `需要 secret 就放进 step 的 env:，再在 run: 里用 shell 判断。`,
      );
    });
  }

  /* ── ② 触发分支必须和远端实际分支对得上 ─────────────────────── */
  let remoteBranches = [];
  try {
    const { execSync } = require('child_process');
    const out = execSync('git branch -r --format="%(refname:short)"', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    remoteBranches = out
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && s !== 'origin' && !s.endsWith('/HEAD'))
      .map((s) => s.replace(/^origin\//, ''));
  } catch (e) {
    // 没有 git 环境（比如从 tar 包解开）就跳过这一项，不误报
    warn(CHECK, '拿不到远端分支列表（不在 git 仓库里？），跳过触发分支检查');
    return;
  }

  if (remoteBranches.length === 0) return;

  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const src = fs.readFileSync(f, 'utf-8');
    for (const m of src.matchAll(/branches:\s*\[([^\]]*)\]/g)) {
      const names = m[1]
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      for (const n of names) {
        if (n === '**' || n.startsWith('!')) continue;
        if (!remoteBranches.includes(n)) {
          err(
            CHECK,
            `${rel} 的触发分支写了 "${n}"，但远端没有这个分支（现有：${remoteBranches.join(', ')}）。` +
              `→ push 到这个分支【永远不会触发 CI】，而且【没有任何报错】。`,
          );
        }
      }
    }
  }

  if (!errors.some((e) => e.startsWith(`[${CHECK}]`))) {
    note(CHECK, `workflow 上下文合法（${files.length} 个文件，触发分支对齐 ${remoteBranches.join(', ')}）`);
  }
}

/* ═══════════════════════════════════════════════════════════════
 * 10. 评测报告分流护栏
 *
 * ⭐ 2026-10-28 加的，因为踩过一次真事故。
 *
 *   跑 `npm run eval:dry`（不花钱的框架自检）把正式基线
 *   eval/RESULTS.md 整个覆盖了 —— 93% 掉成 3%。
 *   而 dry 模式根本没调 LLM，那 29 个 fail 全是 mock 造的假象。
 *
 *   后果的严重性在于：RESULTS.md 是这个项目【对外展示能力基线】的
 *   唯一出处（README 徽章 / 简历数字 / 面试报告都引用它），
 *   而一条随手命令就能冲掉它，且没有任何报错。
 *
 *   修法是"报告按跑批类型分流"，落在 src/eval/report.ts 的
 *   ReportVariant 上，单元测试 src/__tests__/eval/reportIsolation.test.ts
 *   是真正的护栏。
 *
 *   这里再查两件"容易漏"的事：
 *   ① report.ts 里的分流常量还在不在（防止有人图省事把 variant 参数删了）
 *   ② .gitignore 有没有把非正式报告排掉（漏了 = dry 报告会被提交上去，
 *      面试官翻 git log 会看到一份 3% 的"评测报告"）
 * ═══════════════════════════════════════════════════════════════ */
function checkReportIsolation() {
  const CHECK = 'report-isolation';
  const reportSrc = readText('src/eval/report.ts');

  if (!/export type ReportVariant/.test(reportSrc)) {
    err(
      CHECK,
      'src/eval/report.ts 里找不到 ReportVariant 类型。' +
        '→ 报告分流被删了：dry / partial / ablation 会重新覆盖正式基线 RESULTS.md。',
    );
  }

  for (const v of ['dry', 'partial', 'ablation']) {
    if (!new RegExp(`RESULTS\\.${v}\\.md`).test(reportSrc)) {
      err(
        CHECK,
        `src/eval/report.ts 里没有 RESULTS.${v}.md 的分流文件名。` +
          `→ ${v} 模式的报告会覆盖正式基线 RESULTS.md。`,
      );
    }
  }

  const ig = readText('.gitignore');
  for (const f of [
    'eval/RESULTS.dry.md',
    'eval/RESULTS.partial.md',
    'eval/RESULTS.ablation.md',
    'eval/results.dry.json',
    'eval/results.partial.json',
    'eval/results.ablation.json',
  ]) {
    if (!ig.includes(f)) {
      err(
        CHECK,
        `.gitignore 缺少 "${f}" → 非正式基线的评测报告会被提交进版本库，` +
          `面试官翻 git log 会看到一份 dry 模式造出来的假报告。`,
      );
    }
  }

  if (!errors.some((e) => e.startsWith(`[${CHECK}]`))) {
    note(CHECK, '评测报告分流护栏齐全（dry / partial / ablation 各自独立文件）');
  }
}

/* ═══════════════════════════════════════════════════════════════
 * 11. README 徽章的 pass rate 必须与实测报告一致
 *
 * ⭐ 这一条是 2026-10-28 加的，因为真的出过事故。
 *
 *   README 顶部徽章写「eval-30 题 · 100%」，
 *   而 eval/RESULTS.md 里躺着的最新数据是「93%（28/30）」。
 *   两句话在同一个仓库里互相矛盾 —— 面试官一对照就是「数据不实」。
 *
 *   为什么这类漂移特别危险：
 *     它【不会让任何东西变红】。文档不是代码，测试不会失败，CI 不会拦你。
 *     它只会安静地躺在那里，等到某天有人同时打开这两个页面。
 *
 *   比喻：这就像出厂合格证上印的重量，和实物对不上。
 *     产品本身没问题，检测流程也没问题 —— 但这张证一旦被拿出去，就废了。
 *
 *   所以：徽章是「对外承诺」，报告是「实测证据」，
 *   两者必须由机器核对，不能靠人记得同步。
 * ═══════════════════════════════════════════════════════════════ */
function checkEvalBadge() {
  const CHECK = 'eval-badge';

  const resultsPath = path.join(EVAL, 'RESULTS.md');
  if (!fs.existsSync(resultsPath)) {
    warn(CHECK, '找不到 eval/RESULTS.md —— 无法核对 README 徽章（先跑 npm run eval）');
    return;
  }

  const readme = readText('README.md');

  // 徽章 URL 是 URL 编码的：badge/eval-30%20%E9%A2%98%20%C2%B7%20100%25
  const badgeRaw = readme.match(/badge\/eval-[^"'\s)]+/);
  if (!badgeRaw) {
    err(CHECK, 'README 里找不到 eval 徽章 —— 对外展示能力的入口没了');
    return;
  }
  let decoded = badgeRaw[0];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* 解不开就按原文匹配 */
  }
  const bm = decoded.match(/eval-(\d+)\s*题\s*·\s*(\d+)%/);
  if (!bm) {
    err(CHECK, `无法从 README 徽章解析出「题数 · pass rate」：${decoded}`);
    return;
  }
  const badgeTasks = Number(bm[1]);
  const badgeRate = Number(bm[2]);

  // 从报告里取「实测」数字 —— 只看 Pass Rate 那一行，避免误抓别处的 x/y
  const resultsSrc = fs.readFileSync(resultsPath, 'utf-8');
  const prLine = resultsSrc.split('\n').find((l) => l.includes('**Pass Rate**'));
  if (!prLine) {
    err(CHECK, 'eval/RESULTS.md 里找不到 Pass Rate 行 —— 报告格式变了？');
    return;
  }
  const rm = prLine.match(/\*\*(\d+)%\*\*/);
  const tm = prLine.match(/(\d+)\/(\d+)/);
  if (!rm || !tm) {
    err(CHECK, `无法从 eval/RESULTS.md 的 Pass Rate 行解析数字：${prLine.trim()}`);
    return;
  }
  const realRate = Number(rm[1]);
  const realTotal = Number(tm[2]);

  if (badgeRate !== realRate) {
    err(
      CHECK,
      `README 徽章写 pass rate ${badgeRate}%，但 eval/RESULTS.md 实测是 ${realRate}%（${tm[1]}/${realTotal}）。` +
        `→ 两句话在同一仓库里互相矛盾，面试官一对照就是「数据不实」。` +
        `修法：跑 \`npm run eval\` 重新生成报告，然后把徽章改成实测值。`,
    );
  }
  if (badgeTasks !== realTotal) {
    err(
      CHECK,
      `README 徽章写 ${badgeTasks} 题，但 eval/RESULTS.md 的实际题量是 ${realTotal} 题。`,
    );
  }

  if (!errors.some((e) => e.startsWith(`[${CHECK}]`))) {
    note(CHECK, `README 徽章与实测报告一致（${realRate}% · ${realTotal} 题）`);
  }
}

/* ═══════════════════════════════════════════════════════════════
 * 12. Webview 空白面板护栏
 *
 * ⭐ 2026-10-28 加的，因为真的白过屏。
 *
 *   症状：聊天面板打开后【完全空白】。控制台一片干净，没有任何报错。
 *   根因：Webview 的 CSP 里没有 nonce，而 VS Code 1.142 把你的 HTML
 *        塞进 sandbox iframe，它只自动重写 `vscode-resource:` 旧式端点 ——
 *        硬拼 ${cspSource} 一旦域名推断失配，script 被【静默拦掉】。
 *
 *   这条守卫守两件事：
 *     ① CSP 里必须带 nonce（不依赖版本相关的域名推断）
 *     ② 页面里必须留"加载失败可见"的兜底提示
 *        —— React 挂载成功时它会自动消失；没挂载时它留在屏幕上。
 *        这条把"白屏"变成"有文字的白屏"，下次一眼看出是脚本没跑。
 *
 *   两个都靠"人记得"是保不住的，所以进 CI。
 * ═══════════════════════════════════════════════════════════════ */
function checkWebviewGuard() {
  const CHECK = 'webview-guard';

  // ① src/webview/html.ts 存在且 CSP 带 nonce
  const htmlSrcPath = path.join(SRC, 'webview', 'html.ts');
  if (!fs.existsSync(htmlSrcPath)) {
    err(CHECK, '找不到 src/webview/html.ts —— Webview HTML 生成逻辑被挪走或删了？');
  } else {
    const htmlSrc = fs.readFileSync(htmlSrcPath, 'utf-8');
    if (!/script-src 'nonce-/.test(htmlSrc) && !/'nonce-\$\{/.test(htmlSrc)) {
      err(
        CHECK,
        'src/webview/html.ts 里的 CSP 没有 nonce。' +
          '→ 面板可能再次变成空白（VS Code 版本间 CSP 域名推断会变）。',
      );
    }
    if (!/<base href=/.test(htmlSrc)) {
      err(CHECK, "src/webview/html.ts 没有注入 <base href> 兜底 → 相对路径资源会 404");
    }
  }

  // ② webview-ui/index.html 必须留兜底提示
  const indexHtmlPath = path.join(ROOT, 'webview-ui', 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    err(CHECK, '找不到 webview-ui/index.html');
  } else {
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');
    if (!indexHtml.includes('正在加载')) {
      err(
        CHECK,
        'webview-ui/index.html 里没有"正在加载"兜底提示。' +
          '→ 面板出问题时会是【完全空白】，没有任何线索。' +
          '请把 #root 里的兜底 div 放回去（React 挂载成功后会自动清掉它）。',
      );
    }
  }

  if (!errors.some((e) => e.startsWith(`[${CHECK}]`))) {
    note(CHECK, 'Webview 护栏齐全（CSP 带 nonce + 空白兜底提示）');
  }
}

/* ═══════════════════════════════════════════════════════════════
 * 13. Webview 端必须用 acquireVsCodeApi()，不能声明假的 vscode 全局
 *
 * ⭐ 2026-10-28 加的 —— 这是白屏面板【真正的直接根因】。
 *
 *   旧代码这么写：
 *     declare const vscode: { postMessage: (msg: any) => void };
 *
 *   看起来没问题，但 —— `declare` 是【TypeScript 的类型声明】，
 *   编译后**什么都不剩**，运行时根本不存在一个叫 `vscode` 的全局变量。
 *
 *   而 VS Code 的 webview 里**没有** `vscode` 全局对象，
 *   唯一正确的拿 API 的方式是：
 *     const vscode = acquireVsCodeApi();
 *
 *   于是运行时第一行 `vscode.postMessage(...)` 就抛
 *   "vscode is not defined" → React 挂载直接崩 → 面板一片空白，
 *   而且【控制台里什么都没有】（异常发生在 webview 里，不在扩展宿主里）。
 *
 *   为什么难查：
 *     · 扩展宿主日志一切正常（面板创建了、状态栏注册了）
 *     · 错误在 webview 内部，扩展宿主看不到
 *     · 白屏和"加载中"在屏幕上长得一模一样
 *
 *   修法（2026-10-28）：改成 acquireVsCodeApi()，
 *   并加这条守卫 —— 谁再改回 declare const vscode，CI 立刻红。
 * ═══════════════════════════════════════════════════════════════ */
function checkVscodeApiUsage() {
  const CHECK = 'vscode-api';
  const chatPanelPath = path.join(ROOT, 'webview-ui', 'src', 'components', 'ChatPanel.tsx');

  if (!fs.existsSync(chatPanelPath)) {
    err(CHECK, '找不到 webview-ui/src/components/ChatPanel.tsx');
    return;
  }

  const src = fs.readFileSync(chatPanelPath, 'utf-8');

  if (/declare\s+const\s+vscode\s*:/.test(src)) {
    err(
      CHECK,
      'ChatPanel.tsx 里用了 `declare const vscode: {...}`。' +
        '→ `declare` 只是 TS 类型声明，编译后不存在，运行时是 "vscode is not defined" → ' +
        'React 挂载崩溃 → 聊天面板【完全空白】且没有任何报错。' +
        '正确写法：`const vscode = acquireVsCodeApi();`',
    );
  }

  if (!/acquireVsCodeApi\s*\(/.test(src)) {
    err(
      CHECK,
      'ChatPanel.tsx 里没有调用 acquireVsCodeApi()。' +
        '→ VS Code webview 里没有 `vscode` 全局对象，' +
        '必须用 acquireVsCodeApi() 拿 API，否则面板无法与扩展通信。',
    );
  }

  if (!errors.some((e) => e.startsWith(`[${CHECK}]`))) {
    note(CHECK, 'Webview 正确使用 acquireVsCodeApi()');
  }
}

/* ═══════════════════════════════════════════════════════════════ */

function main() {
  const checks = [
    checkProviderEnum,
    checkToolRegistry,
    checkMcpNaming,
    checkFileSize,
    checkVscodeignore,
    checkEvalOracles,
    checkNoSecrets,
    checkNoDrift,
    checkWorkflowContexts,
    checkReportIsolation,
    checkEvalBadge,
    checkWebviewGuard,
    checkVscodeApiUsage,
  ];

  for (const c of checks) {
    try {
      c();
    } catch (e) {
      err(c.name, `检查本身崩了：${e && e.message ? e.message : e}`);
    }
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' Mini-Coder 项目自检');
  console.log('══════════════════════════════════════════════════════════════');
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log('');

  if (errors.length === 0) {
    console.log(`✅ 全部通过（${notes.length} 项检查）`);
    process.exit(0);
  }
  console.log(`❌ ${errors.length} 项检查未通过，${warnings.length} 项警告`);
  process.exit(1);
}

main();
