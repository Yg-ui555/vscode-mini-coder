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
          `→ 说明有职责没拆出去。参考 ROADMAP_V2.md「Phase 4：主循环管线化」的做法。`,
      );
    }
  }
  if (!errors.some((e) => e.startsWith(`[${CHECK}]`))) {
    note(CHECK, `所有源文件都在 ${MAX_FILE_LINES} 行以内（最大：${worst.rel} ${worst.lines} 行）`);
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

/* ═══════════════════════════════════════════════════════════════ */

function main() {
  const checks = [
    checkProviderEnum,
    checkToolRegistry,
    checkFileSize,
    checkVscodeignore,
    checkEvalOracles,
    checkNoSecrets,
    checkNoDrift,
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
