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

const PROVIDER_DEFAULTS = {
  minimax: { baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' },
};

/* ────────────── 参数 ────────────── */

function parseArgs(argv) {
  const opts = {
    workspace: '',
    iterations: 40,
    out: '',
    full: false,
    timeoutMs: 15 * 60 * 1000,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--iterations') opts.iterations = parseInt(argv[++i], 10) || opts.iterations;
    else if (a === '--out') opts.out = argv[++i];
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

  console.log('═'.repeat(62));
  console.log('Mini-Coder 项目体检');
  console.log('═'.repeat(62));
  console.log(`工作区：${workspace}`);
  console.log(`工具集：${opts.full ? '全部 9 个（含写文件 + run_shell）' : '只读 4 个（read_file / grep / glob / list_dir）'}`);
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
  const model = env.model || defaults.model;
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
  setCheckpointEnabled(false); // 不写 .mini-coder/checkpoint
  setToolOutputEnabled(false); // 不写 .mini-coder/tool-output
  setNotesRoot(sandboxNotes); // 不写 .notes

  const registry = opts.full ? createDefaultRegistry() : createReadOnlyRegistry();
  const provider = new OpenAIProvider(baseUrl, apiKey, model);
  const loop = new AgentLoop(provider, registry, opts.iterations, model);

  const messages = [
    { role: 'system', content: new ContextBuilder(workspace, null, registry.names).buildSystemPrompt() },
    { role: 'user', content: AUDIT_PROMPT },
  ];

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
> 模型：${providerName} / ${model} · 工具集：${opts.full ? '全部 9 个' : '只读 4 个'}

## 执行统计

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
