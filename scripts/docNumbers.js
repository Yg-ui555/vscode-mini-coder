#!/usr/bin/env node
/**
 * ⭐⭐ 文档数字核对 —— 把"文档里声称的数字"和"代码实测数字"逐条对上
 *
 * ── 为什么要有这个文件 ──
 *
 *   这个项目的卖点是"每条数字都能复现"。
 *   但手写的数字必然会漂：
 *     · 加一个测试文件 → "37 个测试文件"过期
 *     · 加 11 个用例     → "529 个用例"过期
 *     · 删掉一个死代码   → "93 个源文件"过期
 *
 *   而且这种漂移是【完全静默的】：
 *     文档不会报错，测试不会失败，git 不会拦你。
 *     只有面试官打开两个页面一对照才会发现 —— 那时候已经晚了。
 *
 *   所以：数字必须由【机器】核对，不能靠人记得同步。
 *
 * ── 口径 ──
 *
 *   实测值来自 scripts/stats.js --json（唯一真相源）。
 *   本文件只做一件事：把文档里的数字【抠出来】，和实测值逐条比。
 *
 * ── 为什么要按"指标"而不是按"数字"扫 ──
 *
 *   文档里到处都是数字：token 数、成本、耗时、题号、档位……
 *   全局扫一遍数字必然误报（比如"¥2.545"根本不是行数）。
 *   所以这里给每个指标配【专属的上下文锚点】——
 *   只有"紧跟在正确标签旁边的那个数字"才会被当成该指标的声称值。
 *
 * ── 三类必须放过的数字 ──
 *
 *   ① 历史快照：docs/archive/、docs/issues/、docs/audit/ 一律不查；
 *      文档正文里带"历史 / 快照 / 当时"的行也不查。
 *   ② 带日期的历史记录：同一行里有日期、且没有"最新/当前"字样 → 不查。
 *   ③ 设计目标：未勾选的待办、含"≥ / 目标 / 计划"的行 → 不查。
 *
 *   这三条是硬要求：把设计目标误判成"不一致"，
 *   这个守卫就会被当成噪音关掉 —— 那它比没有还糟。
 */

'use strict';

const fs = require('fs');
const path = require('path');

/* ══════════════════════════════════════════════════════════════
 * 要核对的文档（白名单）
 *
 *   ⚠️ 只查这几份。新增文档时记得往里加，
 *      否则新文档里的数字漂移没人管。
 * ══════════════════════════════════════════════════════════════ */
const DOC_FILES = [
  'README.md',
  'ARCHITECTURE.md',
  'AGENTS.md',
  'PROJECT.md',
  'ROADMAP.md',
  'docs/GLOSSARY.md',
  'docs/PLAIN_ROADMAP.md',
  'RUN.md',
];

/**
 * 明确不核对的目录：带日期的历史归档
 *
 *   里面的旧数字【不是错】，是"当时的事实"。
 *   报错只会制造噪音，噪音的结果就是守卫被关掉。
 */
const SKIP_DOC_RE = [/^docs\/archive\//, /^docs\/issues\//, /^docs\/audit\//];

/* ══════════════════════════════════════════════════════════════
 * 行的"身份判定"：这一行说的是【现状】还是【历史/目标】？
 * ══════════════════════════════════════════════════════════════ */

/** 历史快照的标记 */
const HISTORICAL_RE = /历史|快照|当时|曾经|旧版|早期|原来|原先|校正|已修正|第一版|当年/;

/**
 * 实验记录（消融）的标记
 *
 *   消融表里记的是"【那次实验当时】有几个工具"——
 *   那次实验跑的时候工具集比现在少（README 里专门有一段解释这件事）。
 *   它是实验记录，不是当前配置，不该按现状核对。
 */
const RECORD_RE = /消融/;

/**
 * 举例说明的标记
 *
 *   术语表里有大量"通俗解释 / 类比"，
 *   里面的数字（"我要调 3 个工具"）是编出来的例子，不是项目统计。
 */
const ILLUSTRATIVE_RE = /通俗解释|类比|例如|假设|想象/;

/** 设计目标的标记 */
const GOAL_RE = /≥|目标|计划|期望|打算|至少|新增|不超过|→/;

/** 未勾选的待办 = 还没做的事 */
const UNCHECKED_RE = /^\s*[-*]\s*\[\s\]/;

/** "现状"标记：有它就说明这行说的是当前值 */
const CURRENT_RE = /最新|当前|现在|现状|目前/;

/** 行内的日期 */
const DATE_RE = /20\d\d-\d\d-\d\d/;

/**
 * 数字前面的限定词：说明这个数字【不是总数】
 *
 *   · 第 1 个文件 —— 是序号，不是"有几个文件"
 *   · 其余 8 个 Operation —— 是"剩下的那些"，不是总数
 *   · 只覆盖 1 个 Operation —— 是"其中一部分"，不是总数
 */
const PARTIAL_RE = /第|其余|其他|剩下|另外|覆盖/;

/** 数字紧邻的波浪线/连字符 —— 说明这是个【区间】，不是确切值 */
const RANGE_EDGE_RE = /[~～\-–—]$/;
const RANGE_EDGE_AFTER_RE = /^[~～\-–—]/;

/**
 * 这一行要不要跳过
 *
 * @returns {string|null} 跳过的理由；null 表示这一行要参与核对
 */
function skipReason(line) {
  if (HISTORICAL_RE.test(line)) return '历史记录';
  if (RECORD_RE.test(line)) return '实验记录';
  if (ILLUSTRATIVE_RE.test(line)) return '举例说明';
  if (UNCHECKED_RE.test(line)) return '未完成的目标';
  if (GOAL_RE.test(line)) return '设计目标';
  // 带日期的历史记录 —— 但明写"最新/当前"的是现状，放行
  if (DATE_RE.test(line) && !CURRENT_RE.test(line)) return '带日期的历史记录';
  return null;
}

/* ══════════════════════════════════════════════════════════════
 * 指标表
 *
 *   expect(stats) → 实测值；返回 null 表示这个指标当前不可核对
 * ══════════════════════════════════════════════════════════════ */
const METRICS = {
  sourceFiles: { label: 'src/ 非测试源文件数', expect: (s) => s.source.files },
  sourceLines: { label: 'src/ 非测试源代码行数', expect: (s) => s.source.lines },
  testFiles: { label: '测试文件数', expect: (s) => s.tests.files },
  testLines: { label: '测试代码行数', expect: (s) => s.tests.lines },
  testCases: { label: '测试用例数', expect: (s) => (s.testCases ? s.testCases.total : null) },
  tools: { label: '内置工具数（ALL_TOOL_NAMES）', expect: (s) => s.tools.named },
  operations: { label: 'Operation 数', expect: (s) => s.operations },
  slashCommands: { label: 'slash command 数', expect: (s) => s.slashCommands },
  mcpFiles: { label: 'MCP 客户端源文件数', expect: (s) => s.mcp.files },
  webviewFiles: { label: 'webview-ui 源文件数', expect: (s) => s.webview.files },
  webviewLines: { label: 'webview-ui 代码行数', expect: (s) => s.webview.lines },
};

/**
 * 抠数字的规则表
 *
 *   每条规则 = 一个正则 + 它抠出来的数字分别属于哪些指标。
 *   正则里【必须】有足够的上下文锚点（标签），
 *   否则同一个数字会被安到错误的指标上。
 *
 *   map 的顺序 = 捕获组的顺序。
 */
const EXTRACTORS = [
  /* ── src/ 概览 ── */
  {
    re: /`src\/`[^\n]{0,40}?非测试[^\n]{0,60}?(\d[\d,]*)\s*个?\s*(?:文件)?\s*[/／]\s*(\d[\d,]*)\s*行/,
    map: ['sourceFiles', 'sourceLines'],
  },
  {
    re: /源码[^\n]{0,30}?(\d[\d,]*)\s*个?\s*(?:文件)?\s*[/／]\s*(\d[\d,]*)\s*行/,
    map: ['sourceFiles', 'sourceLines'],
  },
  {
    // "全部相加 = **20,156 行 / 93 个 `.ts` 文件**"（顺序是反的）
    re: /(\d[\d,]*)\s*行\s*[/／]\s*(\d[\d,]*)\s*个\s*`\.ts`\s*文件/,
    map: ['sourceLines', 'sourceFiles'],
  },

  /* ── 测试 ── */
  {
    // ⚠️ 必须用 (?<!非) 排除 "非测试" —— 否则 src/ 的行数会被当成测试的行数
    re: /(?<!非)测试[^\n]{0,25}?(\d[\d,]*)\s*个?\s*(?:文件)?\s*[/／]\s*(\d[\d,]*)\s*行/,
    map: ['testFiles', 'testLines'],
  },
  {
    re: /(?<!非)测试[^\n]{0,25}?(\d[\d,]*)\s*个用例/,
    map: ['testCases'],
  },
  {
    re: /(?<!非)测试[^\n]{0,25}?(\d[\d,]*)\s*个?\s*文件/,
    map: ['testFiles'],
  },
  {
    re: /用例数[^\n]{0,25}?(\d[\d,]*)\s*个/,
    map: ['testCases'],
  },
  {
    re: /(\d[\d,]*)\s*个用例/,
    map: ['testCases'],
  },
  {
    re: /(\d[\d,]*)\+?\s*用例/,
    map: ['testCases'],
  },

  /* ── 工具 ── */
  {
    re: /(\d[\d,]*)\s*个工具/,
    map: ['tools'],
  },
  {
    re: /工具清单[（(]\s*(\d[\d,]*)\s*个/,
    map: ['tools'],
  },
  {
    re: /\|\s*工具\s*\|[^\n]{0,15}?(\d[\d,]*)\s*个/,
    map: ['tools'],
  },
  {
    // "工具 **11 个**" —— 要求后面跟着加粗，避免误抓"工具名单一致（注册 16 个）"
    re: /工具\s*\*\*\s*(\d[\d,]*)\s*个/,
    map: ['tools'],
  },
  {
    re: /agent\/tools\/[^\n]{0,12}?(\d[\d,]*)\s*个/,
    map: ['tools'],
  },

  /* ── Operation / slash command ── */
  {
    re: /(\d[\d,]*)\s*个\s*Operation/,
    map: ['operations'],
  },
  {
    re: /slashCommands\/[^\n]{0,30}?[（(]\s*(\d[\d,]*)\s*个/,
    map: ['slashCommands'],
  },

  /* ── MCP ── */
  {
    re: /MCP\s*源文件\s*\|[^\n]{0,12}?(\d[\d,]*)\s*个/,
    map: ['mcpFiles'],
  },
  {
    re: /MCP[^\n]{0,45}?(\d[\d,]*)\s*(?:个\s*)?(?:源)?文件/,
    map: ['mcpFiles'],
  },

  /* ── 前端 ── */
  {
    re: /webview-ui\/src\/[^\n]{0,25}?(\d[\d,]*)\s*个?\s*文件\s*[/／]\s*(\d[\d,]*)\s*行/,
    map: ['webviewFiles', 'webviewLines'],
  },
  {
    // "**2,379 行**（10 个文件，含 styles.css 1,068 行）"（顺序是反的）
    re: /webview-ui\/src\/[^\n]{0,25}?(\d[\d,]*)\s*行[^\n]{0,12}?[（(]\s*(\d[\d,]*)\s*个文件/,
    map: ['webviewLines', 'webviewFiles'],
  },
];

/* ══════════════════════════════════════════════════════════════
 * 核心：从文档里抠出所有"声称值"
 * ══════════════════════════════════════════════════════════════ */

/**
 * 这个声称值要不要参与核对
 *
 *   有些数字虽然长得像统计值，其实不是"总数"：
 *     · "第 1 个文件"      —— 序号
 *     · "其余 8 个 Operation" —— "剩下的那些"，总数是 9
 *     · "4~6 个 Operation" —— 区间
 *     · "622+ 用例"        —— 下限（真的比它多不算错）
 *
 * @returns {{skip:boolean, floor:boolean}}
 */
function classifyClaim(full, raw, linePre) {
  const pos = full.indexOf(raw);
  const before = pos >= 0 ? full.slice(0, pos) : '';
  const after = pos >= 0 ? full.slice(pos + raw.length) : '';

  // 区间（4~6）：数字前后紧邻波浪线/连字符
  if (
    RANGE_EDGE_RE.test(before) ||
    RANGE_EDGE_AFTER_RE.test(after) ||
    RANGE_EDGE_RE.test(linePre)
  ) {
    return { skip: true, floor: false };
  }

  // 部分数（第 N 个 / 其余 N 个）：数字前面有限定词
  if (PARTIAL_RE.test(before) || PARTIAL_RE.test(linePre)) {
    return { skip: true, floor: false };
  }

  // 下限（622+）：只报"实际比它还少"
  if (after.startsWith('+')) {
    return { skip: false, floor: true };
  }

  return { skip: false, floor: false };
}

/**
 * 整个小节都要跳过的标题
 *
 *   消融实验那一节记的是"那次实验当时的工具集"，
 *   表格里的数字连行内标记都没有（解释写在表格后面的引用块里），
 *   所以只能按【小节】整体跳过。
 */
const SKIP_SECTION_RE = /消融/;

/**
 * @param {string} text 文档全文
 * @param {string} docName 文档名（用于报错信息）
 * @returns {{metric:string, claimed:number, line:number, snippet:string,floor:boolean}[]}
 */
function extractClaims(text, docName) {
  // ⚠️ 必须用 /\r?\n/ 切：仓库里有些文档是 CRLF 行尾（Windows 编辑器存的），
  //   用 split('\n') 会在每行末尾留下一个 \r，
  //   而正则里的 . 不匹配 \r（JS 把它当行终止符）→ 标题那行就匹配不上了。
  const lines = text.split(/\r?\n/);
  const claims = [];

  let heading = null;
  let inSkippedSection = false;

  lines.forEach((line, idx) => {
    // ── 小节标题：决定"这一节整体要不要跳过" ──
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      // 同级或更高级的标题出现 → 上一个 section 结束
      if (heading && level <= heading.level) inSkippedSection = false;
      heading = { level, text: h[2] };
      if (SKIP_SECTION_RE.test(h[2])) inSkippedSection = true;
      return;
    }
    if (inSkippedSection) return;
    if (skipReason(line)) return;

    for (const { re, map } of EXTRACTORS) {
      const g = new RegExp(re.source, 'g');
      let m;
      while ((m = g.exec(line)) !== null) {
        const linePre = line.slice(Math.max(0, m.index - 20), m.index);
        for (let i = 0; i < map.length; i++) {
          const raw = m[i + 1];
          if (raw === undefined) continue;
          const claimed = Number(String(raw).replace(/,/g, ''));
          if (!Number.isFinite(claimed)) continue;

          const { skip, floor } = classifyClaim(m[0], String(raw), linePre);
          if (skip) continue;

          claims.push({
            metric: map[i],
            claimed,
            line: idx + 1,
            snippet: line.trim().slice(0, 120),
            floor,
            doc: docName,
          });
        }
        if (m.index === g.lastIndex) g.lastIndex++;
      }
    }
  });

  return claims;
}

/**
 * 把声称值和实测值逐条比
 *
 * @param {object} stats scripts/stats.js --json 的输出
 * @param {{name:string, text:string}[]} docs 要核对的文档
 * @returns {{metric:string,label:string,doc:string,line:number,claimed:number,expected:number,snippet:string}[]}
 */
function compareDocNumbers(stats, docs) {
  const mismatches = [];
  const seen = new Set();

  for (const { name, text } of docs) {
    for (const c of extractClaims(text, name)) {
      const meta = METRICS[c.metric];
      if (!meta) continue;
      const expected = meta.expect(stats);
      if (expected === null || expected === undefined) continue;
      if (c.claimed === expected) continue;
      // "622+ 用例"是下限：实际比它多不算错
      if (c.floor && expected > c.claimed) continue;

      // 同一个位置同一个指标只报一次（多条规则可能命中同一处）
      const key = `${c.doc}|${c.line}|${c.metric}|${c.claimed}`;
      if (seen.has(key)) continue;
      seen.add(key);

      mismatches.push({
        metric: c.metric,
        label: meta.label,
        doc: c.doc,
        line: c.line,
        claimed: c.claimed,
        expected,
        snippet: c.snippet,
      });
    }
  }

  return mismatches;
}

/**
 * 读要核对的文档
 *
 * @param {string} root 仓库根目录
 * @returns {{name:string, text:string}[]}
 */
function readDocs(root) {
  const out = [];
  for (const rel of DOC_FILES) {
    if (SKIP_DOC_RE.some((re) => re.test(rel))) continue;
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    out.push({ name: rel, text: fs.readFileSync(abs, 'utf-8') });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════
 * CLI（自测用）：node scripts/docNumbers.js
 * ══════════════════════════════════════════════════════════════ */

function main() {
  const ROOT = path.resolve(__dirname, '..');
  const { execSync } = require('child_process');

  let stats;
  try {
    stats = JSON.parse(
      execSync('node scripts/stats.js --json', { cwd: ROOT, encoding: 'utf-8' }),
    );
  } catch (e) {
    console.error('跑不了 scripts/stats.js --json：', e && e.message ? e.message : e);
    process.exit(1);
  }

  const mismatches = compareDocNumbers(stats, readDocs(ROOT));
  console.log(JSON.stringify({ mismatches }, null, 2));
  process.exit(mismatches.length === 0 ? 0 : 1);
}

module.exports = {
  DOC_FILES,
  SKIP_DOC_RE,
  METRICS,
  EXTRACTORS,
  skipReason,
  extractClaims,
  compareDocNumbers,
  readDocs,
};

if (require.main === module) main();
