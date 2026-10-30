#!/usr/bin/env node
/**
 * 项目体检 —— 用 Mini-Coder 自己的 AgentLoop 去审计【任意真实项目】
 *
 * ⭐ 这个脚本解决什么问题：
 *   评测集里的 23 道题都是小沙箱（5-9 个文件），只能回答
 *   「agent 在小项目上能不能改对」。回答不了
 *   「这插件在真实中型项目上还顶不顶得住」。
 *
 *   所以这里把【同一套 AgentLoop + 同一套工具】指向一个真实项目跑一遍。
 *   这是唯一能回答「这东西能不能真用」的办法 —— 而且用的就是插件本尊，
 *   不是另写一套逻辑。
 *
 * 用法：
 *   node scripts/auditProject.js <工作区路径> [选项]
 *   --iterations N   最大轮数（默认 40）
 *   --out <file>     报告输出路径（默认 .tmp/audit-<项目名>-<时间戳>.md）
 *   --full           给全部工具（含 run_shell / 写文件），默认是严格只读
 *
 * ⚠️ 默认【严格只读】：只给 read_file / grep / glob / list_dir，
 *    不给写文件、不给 run_shell —— 保证审计过程不会碰用户项目一个字。
 *    这不是保守，是因为审计的第一要务是「先看清，别动手」。
 */

require('../out/eval/shim'); // ⭐ 第 0 个：劫持 require('vscode')

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { OpenAIProvider } = require('../out/agent/provider');
const { AgentLoop } = require('../out/agent/loop');
const { createReadOnlyRegistry, createDefaultRegistry } = require('../out/agent/tools/factory');
const { ContextBuilder } = require('../out/agent/context');
const { setWorkspaceRoot } = require('../out/agent/tools/paths');
const { setNonInteractive } = require('../out/agent/tools/approval');
const { setEvalWorkspace } = require('../out/eval/shim');
const { setCheckpointEnabled } = require('../out/agent/checkpoint/store');
const { setToolOutputEnabled } = require('../out/agent/toolOutputStore');
const { setNotesRoot } = require('../out/util/notesStore');
const { estimateCost, emptyUsage, addUsage } = require('../out/util/cost');
const { walkFiles, IGNORED_DIRS } = require('../out/agent/tools/fileScan');

/**
 * provider 默认配置 —— 来自 src/providers.json（唯一真相源）
 *
 *   以前这里硬抄了一份，和插件运行时用的那份各写各的 ——
 *   改一处忘一处 → 体检脚本打 MiniMax、插件打 DeepSeek，且没有任何报错。
 *   现在只保留 JSON 一份。
 */
const PROVIDER_DEFAULTS = require('../src/providers.json');

/* ────────────── 参数 ────────────── */

function parseArgs(argv) {
  const opts = {
    workspace: '',
    iterations: 40,
    out: '',
    full: false,
    task: '',
    timeoutMs: 15 * 60 * 1000,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--iterations') opts.iterations = parseInt(argv[++i], 10) || opts.iterations;
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--task') opts.task = argv[++i];
    else if (a === '--full') opts.full = true;
    else if (a === '--timeout') opts.timeoutMs = (parseInt(argv[++i], 10) || 15) * 60 * 1000;
    else rest.push(a);
  }
  opts.workspace = rest[0] || '';
  return opts;
}

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (k === 'MINIMAX_API_KEY' || k === 'DEEPSEEK_API_KEY' || k === 'OPENAI_API_KEY' || k === 'LLM_API_KEY') {
      out.key = v;
    } else if (k === 'MINI_CODER_PROVIDER') out.provider = v;
    else if (k === 'MINI_CODER_MODEL') out.model = v;
    else if (k === 'MINI_CODER_BASE_URL') out.baseUrl = v;
  }
  return out;
}

/* ────────────── 体检任务书 ────────────── */

const AUDIT_PROMPT = `请对当前工作区做一次**只读的代码体检**，并输出结构化报告。

工作区是一个 Python 项目（无锡学院多模态校园智能助手），
包含 RAG 检索、OCR 文档入库、YOLO 目标检测、网页爬虫调度等模块。

请用你手上的 read_file / grep / glob / list_dir 工具**实际去查**，
**不要凭目录名或文件名猜测**。

## 第 1 步：摸清骨架
- list_dir 看顶层结构
- glob 摸清 src/ 下的模块分布（如 glob="src/**/*.py"）
- 给出：模块清单 + 每个模块一句话职责 + **依据**（哪个文件、哪些关键函数）

## 第 2 步：定位核心链路
用 grep 找出这几条链路的实现位置，**必须给出 文件路径:行号**：
- 向量库写入与检索（bge-m3 / embedding / 向量库 / 检索）
- OCR 识别结果落盘与入库
- YOLO 检测调用
- 爬虫调度 / 定时任务

## 第 3 步：工程问题扫描
逐项检查。**每条发现都要给出 文件路径:行号 + 原始代码片段**：
1. 异常处理：裸 except / except: pass / 吞掉异常
2. 硬编码：绝对路径、URL、端口、API key、模型权重路径
3. 资源泄漏：文件句柄、DB 连接、模型实例未关闭
4. 重复代码：多处复制的逻辑块
5. 安全风险：eval / exec / pickle 加载 / shell=True / SQL 拼接
6. 并发与竞态：多线程写同一文件、共享全局状态

## 第 4 步：结论
1. **健康度打分**（每个维度 0-5 分 + 一句话理由）：
   模块化 / 可维护性 / 错误处理 / 安全性 / 测试覆盖 / 文档
2. **最该优先修的 5 个问题**，按严重程度排序，每条给出：
   严重程度（阻断/严重/一般/建议）、文件:行号、问题是什么、为什么危险、怎么改
3. **用 AI 编程助手改造这个项目时的注意事项**（哪些改动风险高、哪些地方必须人工确认）

## 硬性要求
- 每条结论必须有 **文件路径:行号** 证据。没有证据的猜测不要写。
- 找不到就明说"未找到"，**不要编造行号**。
- 中文输出，Markdown 格式。`;

/* ────────────── 扫描预算诊断（不花钱，纯本地） ────────────── */

function scanDiagnostics(workspace) {
  const t0 = Date.now();
  const { files, truncated, reason } = walkFiles({ root: workspace });
  const byExt = {};
  for (const f of files) {
    const m = f.rel.match(/\.([a-z0-9]+)$/i);
    const ext = m ? m[1].toLowerCase() : '(无扩展名)';
    byExt[ext] = (byExt[ext] || 0) + 1;
  }
  const top = Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 12);
  // 一级目录分布
  const topDirs = {};
  for (const f of files) {
    const seg = f.rel.split('/')[0];
    topDirs[seg] = (topDirs[seg] || 0) + 1;
  }
  const topDirList = Object.entries(topDirs).sort((a, b) => b[1] - a[1]).slice(0, 15);
  return {
    total: files.length,
    truncated,
    reason,
    ms: Date.now() - t0,
    ignoredDirs: [...IGNORED_DIRS],
    extTop: top,
    dirTop: topDirList,
    sample: files.slice(0, 5).map((f) => f.rel),
  };
}

/* ────────────── 改前后快照（写模式用） ────────────── */

/**
 * 给每个文件算一个 hash，用来对比「agent 到底改了哪些文件」
 *
 * ⚠️ 为什么要自己算，而不是直接用 git：
 *   插件的改动检测应该【不依赖目标项目有 git】——
 *   很多用户的项目没初始化 git，或者用了别的版本管理。
 *   git 只是一层额外的人工兜底，不是唯一依据。
 */
function snapshotFiles(root) {
  const { files } = walkFiles({ root });
  const map = {};
  for (const f of files) {
    const rel = f.rel;
    // 版本控制内部目录不比对
    if (rel.startsWith('.git/') || rel.includes('/.git/')) continue;
    try {
      const st = fs.statSync(f.abs);
      if (st.size > 2 * 1024 * 1024) {
        map[rel] = 'SKIP_BIG';
        continue;
      }
      map[rel] = crypto.createHash('md5').update(fs.readFileSync(f.abs)).digest('hex');
    } catch {
      map[rel] = 'SKIP_ERR';
    }
  }
  return map;
}

/** 对比两份快照，得出 新增 / 修改 / 删除 三类 */
function diffSnapshots(before, after) {
  const added = [];
  const modified = [];
  const deleted = [];
  for (const [f, h] of Object.entries(after)) {
    if (!(f in before)) added.push(f);
    else if (before[f] !== h) modified.push(f);
  }
  for (const f of Object.keys(before)) {
    if (!(f in after)) deleted.push(f);
  }
  return { added, modified, deleted };
}

/* ────────────── 主流程 ────────────── */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.workspace) {
    console.error('用法：node scripts/auditProject.js <工作区路径> [--iterations N] [--out <file>] [--full]');
    process.exit(1);
  }
  const workspace = path.resolve(opts.workspace);
  if (!fs.existsSync(workspace)) {
    console.error(`❌ 工作区不存在：${workspace}`);
    process.exit(1);
  }

  // ── 任务书：--task 指向一个文件，里面的内容就是给 agent 的任务 ──
  let promptText = AUDIT_PROMPT;
  let taskName = '项目体检';
  if (opts.task) {
    const taskPath = path.resolve(opts.task);
    if (!fs.existsSync(taskPath)) {
      console.error(`❌ 任务书不存在：${taskPath}`);
      process.exit(1);
    }
    promptText = fs.readFileSync(taskPath, 'utf-8');
    taskName = path.basename(taskPath);
  }
  // 任务书模式 = 要动手改，给全部工具；体检模式 = 只读
  const useFullTools = opts.full || !!opts.task;

  console.log('═'.repeat(62));
  console.log('Mini-Coder 项目体检');
  console.log('═'.repeat(62));
  console.log(`工作区：${workspace}`);
  console.log(`模式：${opts.task ? `执行任务书（${taskName}）` : '只读体检'}`);
  console.log(
    `工具集：${useFullTools ? '全部 9 个（含写文件 + run_shell）' : '只读 4 个（read_file / grep / glob / list_dir）'}`,
  );
  console.log(`最大轮数：${opts.iterations}`);
  console.log('');

  // ── 扫描预算诊断（本地，不花钱）──
  console.log('【扫描预算诊断】用插件自己的文件扫描器跑一遍：');
  const diag = scanDiagnostics(workspace);
  console.log(`  扫到文件：${diag.total} 个（耗时 ${diag.ms}ms）`);
  if (diag.truncated) {
    console.log(`  ⚠️ 扫描被截断：${diag.reason}`);
    console.log('     → 下面的搜索结果可能不完整，agent 可能会漏文件');
  } else {
    console.log('  ✅ 扫描完整，未触发上限');
  }
  console.log('  一级目录分布：');
  for (const [d, n] of diag.dirTop) console.log(`    ${String(n).padStart(6)}  ${d}`);
  console.log('  扩展名 top：');
  for (const [e, n] of diag.extTop) console.log(`    ${String(n).padStart(6)}  .${e}`);
  console.log('');

  // ── LLM 配置 ──
  const env = loadEnv();
  const providerName = env.provider || 'deepseek';
  const defaults = PROVIDER_DEFAULTS[providerName] || PROVIDER_DEFAULTS.deepseek;
  const apiKey = env.key || '';
  const baseUrl = env.baseUrl || defaults.baseUrl;
  const model = env.model || defaults.defaultModel;
  if (!apiKey) {
    console.error('❌ 找不到 API Key。请在项目根 .env 里配 DEEPSEEK_API_KEY 或 MINIMAX_API_KEY。');
    process.exit(1);
  }
  console.log(`模型：${providerName} / ${model}`);
  console.log('');

  // ── 隔离：确保不往用户项目里写任何东西 ──
  const sandboxNotes = path.join(os.tmpdir(), `minicoder-audit-notes-${Date.now()}`);
  setEvalWorkspace(workspace);
  setWorkspaceRoot(workspace);
  setNonInteractive(true);
  // ⭐ 写模式【开 checkpoint】—— 顺便验证「改错了能退回来」这个能力。
  //   只读模式不需要（不写文件，存了也是白存）。
  //   checkpoint 落在 <工作区>/.mini-coder/checkpoints/，
  //   所以任务书里会要求把 .mini-coder/ 加进 .gitignore。
  setCheckpointEnabled(useFullTools);
  setToolOutputEnabled(false); // 不写 .mini-coder/tool-output
  setNotesRoot(sandboxNotes); // 错题本写到工作区外，不在用户项目里造 .notes/

  const registry = useFullTools ? createDefaultRegistry() : createReadOnlyRegistry();
  const provider = new OpenAIProvider(baseUrl, apiKey, model);
  const loop = new AgentLoop(provider, registry, opts.iterations, model);

  const messages = [
    { role: 'system', content: new ContextBuilder(workspace, null, registry.names).buildSystemPrompt() },
    { role: 'user', content: promptText },
  ];

  // ⭐ 写模式：跑之前给所有文件拍个快照，跑完对比出「到底改了哪些文件」
  //   这是插件自己的改动检测，不依赖目标项目有 git。
  const snapshotBefore = useFullTools ? snapshotFiles(workspace) : null;

  const toolTrace = [];
  const tokenTotal = emptyUsage();
  let llmCalls = 0;

  const abort = new AbortController();
  const timer = setTimeout(() => {
    console.log('\n⏱️  超时，打断 agent。');
    abort.abort();
  }, opts.timeoutMs);

  console.log('─'.repeat(62));
  console.log('开始体检（实时工具轨迹）：');
  console.log('─'.repeat(62));

  let finalAnswer = '';
  const t0 = Date.now();
  try {
    finalAnswer = await loop.run(messages, abort.signal, {
      onText: (t) => {
        if (t && t.trim()) process.stdout.write(t);
      },
      onToolCall: () => {},
      onToolResult: (name, result, args) => {
        const a = args || {};
        let brief = '';
        if (a.path) brief = a.path;
        else if (a.pattern) brief = `pattern=${a.pattern}`;
        else if (a.glob) brief = `glob=${a.glob}`;
        toolTrace.push({ tool: name, args: a, isError: !!result.isError });
        const flag = result.isError ? '✗' : '·';
        console.log(`  ${flag} ${name}${brief ? '  ' + brief : ''}`);
      },
      onTokenUsage: (delta) => {
        const s = addUsage(tokenTotal, delta);
        tokenTotal.promptTokens = s.promptTokens;
        tokenTotal.completionTokens = s.completionTokens;
        tokenTotal.totalTokens = s.totalTokens;
        llmCalls++;
      },
    });
  } catch (e) {
    console.error(`\n❌ agent 运行出错：${e && e.stack ? e.stack : e}`);
  } finally {
    clearTimeout(timer);
    abort.abort();
    setWorkspaceRoot(undefined);
    setEvalWorkspace(undefined);
    setCheckpointEnabled(true);
    setToolOutputEnabled(true);
    setNotesRoot(undefined);
    try {
      fs.rmSync(sandboxNotes, { recursive: true, force: true });
    } catch {}
  }

  const durationMs = Date.now() - t0;
  const cost = estimateCost(tokenTotal, model);

  // ⭐ 写模式：跑完对比快照，得出 agent 实际改了哪些文件
  let changes = null;
  if (snapshotBefore) {
    const snapshotAfter = snapshotFiles(workspace);
    changes = diffSnapshots(snapshotBefore, snapshotAfter);
    const total = changes.added.length + changes.modified.length + changes.deleted.length;
    console.log('');
    console.log(`【改动检测】新增 ${changes.added.length} · 修改 ${changes.modified.length} · 删除 ${changes.deleted.length}`);
    for (const f of changes.modified) console.log(`  改  ${f}`);
    for (const f of changes.added) console.log(`  新  ${f}`);
    for (const f of changes.deleted) console.log(`  删  ${f}`);
    if (total === 0) console.log('  （没有任何文件被改动）');
  }

  // ── 出报告 ──
  const outDir = path.join(__dirname, '..', '.tmp');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = opts.out || path.join(outDir, `audit-${path.basename(workspace)}-${stamp}.md`);

  const toolStats = {};
  for (const t of toolTrace) toolStats[t.tool] = (toolStats[t.tool] || 0) + 1;

  const md = `# 项目体检报告 · ${path.basename(workspace)}

> 由 Mini-Coder 自己的 AgentLoop 生成（\`scripts/auditProject.js\`）
> 工作区：\`${workspace}\`
> 时间：${new Date().toLocaleString('zh-CN')}
> 模型：${providerName} / ${model} · 工具集：${useFullTools ? '全部 9 个' : '只读 4 个'}

${changes
      ? `## ⚠️ 改动清单（插件自己算的，不依赖 git）

| 类别 | 数量 | 文件 |
|---|---|---|
| 新增 | ${changes.added.length} | ${changes.added.map((f) => `\`${f}\``).join('、') || '—'} |
| 修改 | ${changes.modified.length} | ${changes.modified.map((f) => `\`${f}\``).join('、') || '—'} |
| 删除 | ${changes.deleted.length} | ${changes.deleted.map((f) => `\`${f}\``).join('、') || '—'} |

`
      : ''}## 执行统计

| 指标 | 值 |
|---|---|
| LLM 调用轮数 | ${llmCalls} |
| 工具调用次数 | ${toolTrace.length} |
| 工具分布 | ${Object.entries(toolStats).map(([k, v]) => `${k}×${v}`).join(' / ') || '（无）'} |
| 耗时 | ${(durationMs / 1000).toFixed(1)}s |
| token（prompt / completion / 合计） | ${tokenTotal.promptTokens} / ${tokenTotal.completionTokens} / ${tokenTotal.totalTokens} |
| 估算成本 | ¥${(cost && cost.cost !== undefined ? cost.cost : 0).toFixed(4)} |

## 扫描预算诊断

| 指标 | 值 |
|---|---|
| 扫到文件数 | ${diag.total} |
| 是否被截断 | ${diag.truncated ? `⚠️ ${diag.reason}` : '✅ 否'} |
| 扫描耗时 | ${diag.ms}ms |

**一级目录分布**：

${diag.dirTop.map(([d, n]) => `- \`${d}\` — ${n} 个文件`).join('\n')}

**扩展名 top**：

${diag.extTop.map(([e, n]) => `- \`.${e}\` — ${n}`).join('\n')}

## 体检结论

${finalAnswer || '（agent 没有产出最终回答）'}

---

## 工具调用轨迹

${toolTrace.map((t, i) => `${i + 1}. \`${t.tool}\`${t.isError ? ' ✗' : ''}`).join('\n')}
`;

  fs.writeFileSync(outFile, md, 'utf-8');

  const jsonFile = outFile.replace(/\.md$/, '.json');
  fs.writeFileSync(
    jsonFile,
    JSON.stringify(
      {
        workspace,
        model,
        provider: providerName,
        full: opts.full,
        durationMs,
        llmCalls,
        usage: tokenTotal,
        cost,
        diagnostics: diag,
        toolTrace,
        finalAnswer,
      },
      null,
      2,
    ),
    'utf-8',
  );

  console.log('');
  console.log('═'.repeat(62));
  console.log(`✅ 体检完成  轮数 ${llmCalls} · 工具 ${toolTrace.length} 次 · ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`   token ${tokenTotal.totalTokens} · 估算 ¥${(cost && cost.cost !== undefined ? cost.cost : 0).toFixed(4)}`);
  console.log(`📄 报告：${outFile}`);
  console.log(`📊 原始数据：${jsonFile}`);
  console.log('═'.repeat(62));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
