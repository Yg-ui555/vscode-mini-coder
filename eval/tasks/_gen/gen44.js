/**
 * 44-hard-scale-perf-behavior 的初始代码生成器
 *
 * ⭐ 这道题考什么：
 *
 *   上一题（34）已经证明"加个缓存"能被推理出来 —— 因为那个仓库只有 2 个文件。
 *   这道题把规模换成另一种形态：
 *
 *   · 核心实现是【一个 800 行的大文件】，热路径埋在中间，
 *     不分段读根本不知道它在哪儿
 *   · 它有【20 个下游模块】，每一个都建立在它当前的行为之上 ——
 *     包括一些看起来很奇怪的边界行为（缩写不切句、emoji 计数、CJK 不算词……）
 *   · 优化热路径时最容易出的错，就是把这些边界行为"顺手修正"了
 *
 * ⚠️ 关键设计：验收用的是【差分对拍】——
 *   评测侧冻结一份原始实现（frozen/），跟沙箱里的实现逐个输入对比。
 *   所以"快了但算错了"会被立刻发现，而不是像真实项目里那样悄悄上线。
 *
 *   同时 frozen/deps/ 也冻结了 —— agent 改下游模块来"迁就"自己的实现，
 *   一样会被对拍出来。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { writeTree, resetDir, writeFile, statsOf } = require('./lib');

const TASK_ID = '44-hard-scale-perf-behavior';

/**
 * 分析器本体
 *
 * ⚠️ 这份源码会被原样写进两个地方：
 *    initial/src/analyzer.js  —— agent 看得到、可以改
 *    frozen/analyzer.js       —— 评测侧冻结的参考答案，agent 看不到
 *   两份必须逐字一致，所以只写一份模板。
 */
const ANALYZER_SOURCE = `/**
 * 文本分析器 —— 仓库里最核心也最重的模块。
 *
 * ⚠️ 这个文件被 20 个下游模块依赖（src/deps/），
 *    每一个都建立在它【当前的行为】之上 —— 包括一些看起来很奇怪的边界行为：
 *
 *      · 缩写（Dr. / e.g.）不会被当成句子结尾
 *      · CJK 字符不参与分词（一个汉字不是一个 token）
 *      · 词频表按【首次出现顺序】排列，同频的词保持那个顺序
 *      · options.limit 只影响词数和词频，不影响字符数、句子数
 *
 *    改它之前请先想清楚：下游到底依赖的是哪个行为。
 *
 * ## 对外接口
 *
 *   analyze(text, options) —— 唯一的重活入口
 *
 *   ## options
 *
 *   limit —— 最多统计前 N 个词。给超长文档做"预览"时用。
 *            ⚠️ 它会影响 tokenCount 和词频，但【不会】影响字符数、句子数这些。
 */
'use strict';

// ══════════════════════════════════════════════════════════════
// 数据表
// ══════════════════════════════════════════════════════════════

/**
 * 停用词表 —— 用于算 stopwordRatio。
 *
 * ⚠️ 只收英文：中文的分词是另一套问题，这个库没做。
 */
const STOPWORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'done', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he',
  'her', 'here', 'hers', 'him', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'me', 'more', 'most', 'my',
  'no', 'nor', 'not', 'now',
  'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'out', 'over', 'own',
  'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with',
  'would', 'you', 'your', 'yours',
]);

/**
 * 缩写表 —— 这些后面跟的空格【不】算句子结束。
 *
 * ⚠️ 这张表是英文分句的历史包袱，删掉它句子数会变。
 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt',
  'vs', 'etc', 'inc', 'ltd', 'co', 'corp', 'dept', 'est',
  'e.g', 'i.e', 'a.m', 'p.m',
]);

/**
 * 音节例外表 —— 靠猜音节会猜错，这些是人工校正过的。
 */
const SYLLABLE_EXCEPTIONS = {
  every: 2,
  business: 2,
  people: 2,
  water: 2,
  hour: 1,
  honest: 2,
  island: 2,
  iron: 2,
  lion: 2,
  quiet: 2,
  poem: 1,
  being: 2,
  being_: 2,
  science: 2,
  area: 3,
  idea: 3,
  create: 2,
  created: 3,
  fire: 1,
  hired: 2,
  tired: 2,
  wired: 1,
  tired_: 2,
};

/**
 * 词性标记表 —— 给 summarize 用的轻量标注。
 *
 * ⚠️ 这是个玩具级别的实现，只覆盖最常见的词，
 *    别指望它能替代真正的词性标注器。
 */
const POS_TAGS = {
  the: 'DET', a: 'DET', an: 'DET', this: 'DET', that: 'DET', these: 'DET', those: 'DET',
  is: 'AUX', are: 'AUX', was: 'AUX', were: 'AUX', be: 'AUX', been: 'AUX', being: 'AUX',
  have: 'AUX', has: 'AUX', had: 'AUX', do: 'AUX', does: 'AUX', did: 'AUX',
  will: 'AUX', would: 'AUX', should: 'AUX', could: 'AUX', may: 'AUX', might: 'AUX', must: 'AUX',
  and: 'CCONJ', or: 'CCONJ', but: 'CCONJ', so: 'CCONJ', yet: 'CCONJ', for: 'CCONJ',
  in: 'ADP', on: 'ADP', at: 'ADP', to: 'ADP', from: 'ADP', by: 'ADP', with: 'ADP',
  about: 'ADP', into: 'ADP', over: 'ADP', after: 'ADP', under: 'ADP', between: 'ADP',
  quickly: 'ADV', slowly: 'ADV', very: 'ADV', really: 'ADV', always: 'ADV', never: 'ADV',
  often: 'ADV', sometimes: 'ADV', usually: 'ADV', already: 'ADV', still: 'ADV', also: 'ADV',
};

/**
 * 常见词性分布 —— 报告里用来估算"正式程度"。
 */
const FORMALITY_PROFILES = {
  formal: ['therefore', 'however', 'furthermore', 'nevertheless', 'accordingly'],
  casual: ['gonna', 'wanna', 'yeah', 'ok', 'okay', 'stuff', 'kinda', 'yeah'],
  technical: ['function', 'parameter', 'variable', 'interface', 'implementation', 'dependency', 'runtime'],
};

/**
 * 语言标记 —— 用来粗判文本是什么语言的。
 */
const LANGUAGE_HINTS = [
  { lang: 'en', words: ['the', 'and', 'is', 'of', 'to', 'in', 'that', 'it'] },
  { lang: 'fr', words: ['le', 'la', 'les', 'des', 'une', 'est', 'et', 'pour'] },
  { lang: 'de', words: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'mit'] },
  { lang: 'es', words: ['el', 'la', 'los', 'de', 'que', 'en', 'por', 'para'] },
];

/**
 * 标点符号表 —— 用来区分"句内标点"和"句末标点"。
 */
const SENTENCE_ENDINGS = new Set(['.', '!', '?']);

/**
 * 引号表 —— 统计引号配对。
 */
const QUOTE_PAIRS = [
  { open: '"', close: '"' },
  { open: "'", close: "'" },
  { open: '“', close: '”' },
  { open: '‘', close: '’' },
  { open: '（', close: '）' },
  { open: '《', close: '》' },
];

/**
 * 缩进层级 —— 统计缩进代码块。
 */
const INDENT_STEPS = [2, 4, 8];

/**
 * 大小写转换表 —— 只处理 ASCII，行为可预期。
 */
const CASE_TABLE = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
};

/**
 * 词频分档 —— 报告里用来画直方图。
 */
const FREQUENCY_BANDS = [
  { min: 1, max: 1, label: 'hapax' },
  { min: 2, max: 4, label: 'low' },
  { min: 5, max: 19, label: 'medium' },
  { min: 20, max: Infinity, label: 'high' },
];

/**
 * 停用词比例的健康区间 —— 超出这个区间说明文本可能有问题。
 */
const STOPWORD_RATIO_RANGE = { min: 0.1, max: 0.6 };

/**
 * 句子长度的健康区间。
 */
const SENTENCE_LENGTH_RANGE = { min: 4, max: 40 };

/**
 * 常用短语表 —— 用来识别"套话"。
 */
const COMMON_PHRASES = [
  'as a matter of fact',
  'in addition to',
  'on the other hand',
  'at this point in time',
  'for the time being',
  'in terms of',
  'it is important to note',
];

/**
 * 标题层级 —— markdown 标题的语义标签。
 */
const HEADING_LABELS = {
  1: 'title',
  2: 'section',
  3: 'subsection',
  4: 'detail',
  5: 'minor',
  6: 'trace',
};

/**
 * 标点权重 —— 语气打分用。
 */
const PUNCTUATION_WEIGHTS = {
  '.': 1,
  ',': 0.5,
  '?': 2,
  '!': 2,
  ';': 1,
  ':': 1,
  '-': 0.5,
  '(': 0.5,
  ')': 0.5,
  '"': 0.5,
  "'": 0.5,
};

/**
 * 情绪词表 —— 玩具级的情感分析。
 *
 * ⚠️ 只覆盖最常见的几百个词，判不准是正常的。
 */
const POSITIVE_WORDS = new Set([
  'good', 'great', 'better', 'best', 'nice', 'love', 'happy', 'easy', 'fast',
  'clear', 'safe', 'stable', 'useful', 'works', 'working', 'fixed', 'improve',
  'improved', 'success', 'successful', 'win', 'wins', 'passed', 'perfect',
  'recommend', 'reliable', 'robust', 'satisfied', 'successfully',
]);

const NEGATIVE_WORDS = new Set([
  'bad', 'worse', 'worst', 'slow', 'bug', 'bugs', 'broken', 'break', 'breaks',
  'fail', 'failed', 'failing', 'failure', 'error', 'errors', 'crash', 'crashed',
  'issue', 'issues', 'problem', 'problems', 'hard', 'confusing', 'wrong',
  'unstable', 'flaky', 'regression', 'timeout', 'leak',
]);

/**
 * 句子开头词 —— 用来统计句式多样性。
 */
const SENTENCE_STARTERS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'they', 'we',
  'you', 'he', 'she', 'i', 'there', 'here', 'when', 'while', 'if', 'but',
  'and', 'so', 'because', 'however', 'meanwhile', 'finally', 'first', 'then',
]);

/**
 * 数字格式 —— 识别金额 / 百分比 / 年份。
 */
const NUMBER_PATTERNS = {
  money: /[$¥€]\\s?\\d[\\d,]*(?:\\.\\d+)?/g,
  percent: /\\d+(?:\\.\\d+)?%/g,
  year: /\\b(?:19|20)\\d{2}\\b/g,
  decimal: /\\b\\d+\\.\\d+\\b/g,
};

/**
 * 日期格式 —— 三种常见的写法。
 */
const DATE_PATTERNS = {
  iso: /\\b\\d{4}-\\d{2}-\\d{2}\\b/g,
  slash: /\\b\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\b/g,
  chinese: /\\d{4}\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日/g,
};

/**
 * 文件扩展名表 —— 用来判断是不是技术文档。
 */
const FILE_EXTENSIONS = new Set([
  'js', 'ts', 'tsx', 'jsx', 'json', 'md', 'py', 'go', 'rs', 'java',
  'css', 'scss', 'html', 'yml', 'yaml', 'sh', 'sql', 'toml',
]);

/**
 * 主题关键词 —— 粗判文档属于哪个领域。
 */
const TOPIC_KEYWORDS = {
  frontend: ['component', 'render', 'dom', 'css', 'state', 'props', 'hook', 'bundle', 'style'],
  backend: ['service', 'api', 'database', 'query', 'cache', 'queue', 'migration', 'schema', 'index'],
  data: ['dataset', 'feature', 'model', 'training', 'inference', 'pipeline', 'metric', 'vector'],
  product: ['user', 'growth', 'retention', 'funnel', 'campaign', 'pricing', 'churn', 'signup'],
};

/**
 * 常见缩略语 —— 全大写的 token 里，这些是缩略语而不是【喊话】。
 */
const ACRONYMS = new Set([
  'API', 'HTTP', 'HTTPS', 'JSON', 'YAML', 'XML', 'URL', 'URI', 'SQL', 'CLI',
  'SDK', 'IDE', 'CPU', 'GPU', 'RAM', 'SSD', 'SSH', 'TLS', 'SSL', 'CSS', 'DOM',
  'SSR', 'CSRF', 'XSS', 'ORM', 'CI', 'CD', 'UI', 'UX', 'PDF', 'CSV',
]);

/**
 * 段落长度分档。
 */
const PARAGRAPH_BANDS = [
  { max: 80, label: 'short' },
  { max: 200, label: 'medium' },
  { max: Infinity, label: 'long' },
];

/**
 * 代码块围栏的语言标记 —— 出现这些说明是代码。
 */
const CODE_LANGUAGES = new Set([
  'js', 'javascript', 'ts', 'typescript', 'python', 'go', 'rust', 'java',
  'bash', 'sh', 'sql', 'json', 'yaml', 'html', 'css',
]);

// ══════════════════════════════════════════════════════════════
// 基础工具
// ══════════════════════════════════════════════════════════════

/**
 * 统一换行符。
 *
 * ⚠️ 必须先处理 \\r\\n 再处理单独的 \\r ——
 *    顺序反了会把 "\\r\\n" 变成两个换行。
 */
function normalizeNewlines(text) {
  return String(text).replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n');
}

/** 把连续空格和 Tab 压成一个空格 */
function collapseSpaces(text) {
  return String(text).replace(/[ \\t]+/g, ' ');
}

/** 把三个以上的连续换行压成两个 */
function collapseBlankLines(text) {
  return String(text).replace(/\\n{3,}/g, '\\n\\n');
}

/** 完整的归一化：换行 → 空白 → 空行 */
function normalize(text) {
  return collapseBlankLines(collapseSpaces(normalizeNewlines(text)));
}

/**
 * 切句。
 *
 * ⚠️ 缩写后面的空格【不】切句 —— 这条规则被下游的句长统计依赖。
 */
function splitSentences(text) {
  const raw = String(text).split(/(?<=[.!?])\\s+/);
  const out = [];
  for (const piece of raw) {
    if (out.length === 0) {
      out.push(piece);
      continue;
    }
    const last = out[out.length - 1];
    const tail = last.split(/\\s+/).pop() || '';
    const bare = tail.replace(/\\.$/, '').toLowerCase();
    if (ABBREVIATIONS.has(bare)) {
      out[out.length - 1] = last + ' ' + piece;
    } else {
      out.push(piece);
    }
  }
  return out.filter((s) => s.trim().length > 0);
}

/**
 * 分词。
 *
 * ⚠️ 只认 ASCII 字母、数字和撇号 ——
 *    所以中文不会被切成词，emoji 也不会。
 *    下游的"词数"统计建立在这条规则上。
 */
function tokenize(text) {
  return String(text).toLowerCase().match(/[a-z0-9']+/g) || [];
}

/**
 * 猜音节数。
 *
 * ⚠️ 是个粗略的启发式，例外表人工校正了一批常见词。
 */
function countSyllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (Object.prototype.hasOwnProperty.call(SYLLABLE_EXCEPTIONS, w)) {
    return SYLLABLE_EXCEPTIONS[w];
  }
  const stem = w.replace(/e$/, '');
  const groups = stem.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 0;
  if (/[^aeiouy]e$/.test(w)) n += 1;
  return Math.max(1, n);
}

/**
 * 统计字符构成。
 *
 * ⚠️ CJK 单独归一类 —— 它既不是字母也不是标点。
 *    ⚠️ CJK_PATTERN 上不能加 /g：带 /g 的正则有 lastIndex 状态，
 *       复用同一个正则对象会让第二次调用结果不对。
 */
const CJK_PATTERN = /[\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af]/;

function characterClasses(text) {
  let letters = 0;
  let digits = 0;
  let spaces = 0;
  let punctuation = 0;
  let cjk = 0;
  for (const ch of String(text)) {
    if (/\\s/.test(ch)) spaces += 1;
    else if (/[0-9]/.test(ch)) digits += 1;
    else if (/[a-zA-Z]/.test(ch)) letters += 1;
    else if (CJK_PATTERN.test(ch)) cjk += 1;
    else punctuation += 1;
  }
  return { letters, digits, spaces, punctuation, cjk };
}

/** 保留两位小数 */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * 取词频最高的前 n 个。
 *
 * ⚠️ 排序是稳定的 —— 同频的词保持【首次出现的顺序】。
 *    下游的 topWords 列表顺序建立在这条规则上。
 */
function topEntries(frequencies, n) {
  const entries = Object.keys(frequencies).map((w) => ({ word: w, count: frequencies[w] }));
  entries.sort((a, b) => b.count - a.count);
  return entries.slice(0, n);
}

/**
 * 出现最多的二元组。
 *
 * ⚠️ 同频时取【先出现】的那个（遍历顺序即插入顺序）。
 */
function topBigram(tokens) {
  const counts = {};
  for (let i = 0; i + 1 < tokens.length; i++) {
    const g = tokens[i] + ' ' + tokens[i + 1];
    counts[g] = (counts[g] || 0) + 1;
  }
  let best = null;
  let bestCount = 0;
  for (const g of Object.keys(counts)) {
    if (counts[g] > bestCount) {
      bestCount = counts[g];
      best = g;
    }
  }
  return best === null ? null : { text: best, count: bestCount };
}

/** 最长的词（同长取先出现的） */
function longestWord(tokens) {
  let best = '';
  for (const t of tokens) {
    if (t.length > best.length) best = t;
  }
  return best;
}

/** 词总长度 */
function totalLength(tokens) {
  let sum = 0;
  for (const t of tokens) sum += t.length;
  return sum;
}

/** Flesch 阅读难度 */
function fleschScore(tokens, sentences) {
  if (!tokens.length || !sentences) return 0;
  let syllables = 0;
  for (const t of tokens) syllables += countSyllables(t);
  const raw = 206.835 - 1.015 * (tokens.length / sentences) - 84.6 * (syllables / tokens.length);
  return round2(raw);
}

/** 由 Flesch 分数推出年级 */
function gradeLevel(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  if (score >= 50) return 'E';
  return 'F';
}

/** 围栏代码块数量（一对三个反引号算一个） */
function countFences(text) {
  const fences = String(text).match(/\`\`\`/g) || [];
  return Math.floor(fences.length / 2);
}

/** markdown 链接数量 */
function countLinks(text) {
  return (String(text).match(/\\[[^\\]]*\\]\\([^)]*\\)/g) || []).length;
}

/** markdown 标题数量 */
function countHeadings(lines) {
  let n = 0;
  for (const line of lines) {
    if (/^#{1,6}\\s/.test(line)) n += 1;
  }
  return n;
}

/**
 * emoji 数量。
 *
 * ⚠️ 用了 /g 的正则 + match —— match 会重置 lastIndex，所以是安全的。
 */
const EMOJI_PATTERN = /[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{FE00}-\\u{FE0F}\\u{1F000}-\\u{1F2FF}]/gu;

function countEmoji(text) {
  return (String(text).match(EMOJI_PATTERN) || []).length;
}

/** 词频分档统计 */
function frequencyBands(frequencies) {
  const out = {};
  for (const band of FREQUENCY_BANDS) out[band.label] = 0;
  for (const word of Object.keys(frequencies)) {
    const c = frequencies[word];
    for (const band of FREQUENCY_BANDS) {
      if (c >= band.min && c <= band.max) {
        out[band.label] += 1;
        break;
      }
    }
  }
  return out;
}

/**
 * 粗判语言。
 *
 * ⚠️ 靠停用词命中率猜，猜不准是正常的 —— 它只用来给报告一个"倾向"。
 */
function detectLanguage(tokens) {
  if (!tokens.length) return 'unknown';
  let best = 'unknown';
  let bestScore = 0;
  for (const hint of LANGUAGE_HINTS) {
    let hits = 0;
    for (const w of hint.words) {
      if (tokens.indexOf(w) !== -1) hits += 1;
    }
    if (hits > bestScore) {
      bestScore = hits;
      best = hint.lang;
    }
  }
  return best;
}

/** 正式程度打分 */
function formalityScore(tokens) {
  let score = 0;
  for (const t of tokens) {
    if (FORMALITY_PROFILES.formal.indexOf(t) !== -1) score += 1;
    if (FORMALITY_PROFILES.casual.indexOf(t) !== -1) score -= 1;
    if (FORMALITY_PROFILES.technical.indexOf(t) !== -1) score += 1;
  }
  return score;
}

/** 常用套话命中数 */
function commonPhraseHits(text) {
  const lower = String(text).toLowerCase();
  let n = 0;
  for (const p of COMMON_PHRASES) {
    if (lower.indexOf(p) !== -1) n += 1;
  }
  return n;
}

/** 引号配对数量 */
function quotePairs(text) {
  const s = String(text);
  let n = 0;
  for (const pair of QUOTE_PAIRS) {
    const parts = s.split(pair.open).length - 1;
    n += Math.floor(parts / 2);
  }
  return n;
}

/** 缩进层级统计 */
function indentStats(lines) {
  const out = {};
  for (const step of INDENT_STEPS) out['step' + step] = 0;
  for (const line of lines) {
    const m = /^(\\s+)/.exec(line);
    if (!m) continue;
    const width = m[1].replace(/\\t/g, '  ').length;
    for (const step of INDENT_STEPS) {
      if (width === step) out['step' + step] += 1;
    }
  }
  return out;
}

/** 词性分布 */
function posDistribution(tokens) {
  const out = {};
  for (const t of tokens) {
    const tag = POS_TAGS[t];
    if (!tag) continue;
    out[tag] = (out[tag] || 0) + 1;
  }
  return out;
}

/**
 * 语气画像 —— 疑问 / 感叹 / 情绪词。
 *
 * ⚠️ 玩具级实现：情绪词表只有几百个词，别当情感分析用。
 */
function toneProfile(text) {
  const s = String(text);
  let questions = 0;
  let exclamations = 0;
  for (const ch of s) {
    if (ch === '?') questions += 1;
    else if (ch === '!') exclamations += 1;
  }
  const words = s.toLowerCase().match(/[a-z0-9']+/g) || [];
  let positive = 0;
  let negative = 0;
  for (const w of words) {
    if (POSITIVE_WORDS.has(w)) positive += 1;
    else if (NEGATIVE_WORDS.has(w)) negative += 1;
  }
  return { questions, exclamations, positive, negative, score: positive - negative };
}

/** 数字画像 —— 金额 / 百分比 / 年份 / 小数 */
function numberProfile(text) {
  const s = String(text);
  return {
    money: (s.match(NUMBER_PATTERNS.money) || []).length,
    percent: (s.match(NUMBER_PATTERNS.percent) || []).length,
    year: (s.match(NUMBER_PATTERNS.year) || []).length,
    decimal: (s.match(NUMBER_PATTERNS.decimal) || []).length,
  };
}

/** 日期线索 */
function dateHints(text) {
  const s = String(text);
  return {
    iso: (s.match(DATE_PATTERNS.iso) || []).length,
    slash: (s.match(DATE_PATTERNS.slash) || []).length,
    chinese: (s.match(DATE_PATTERNS.chinese) || []).length,
  };
}

/** 缩略语数量（只算已知缩略语，全大写的喊话不算） */
function acronymCount(text) {
  const matches = String(text).match(/\b[A-Z]{2,}\b/g) || [];
  let n = 0;
  for (const m of matches) {
    if (ACRONYMS.has(m)) n += 1;
  }
  return n;
}

/** 主题猜测 */
function topicGuess(tokens) {
  let best = 'unknown';
  let bestScore = 0;
  for (const topic of Object.keys(TOPIC_KEYWORDS)) {
    let score = 0;
    for (const kw of TOPIC_KEYWORDS[topic]) {
      if (tokens.indexOf(kw) !== -1) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = topic;
    }
  }
  return best;
}

/** 段落长度分档 */
function paragraphBands(paragraphs) {
  const out = {};
  for (const band of PARAGRAPH_BANDS) out[band.label] = 0;
  for (const p of paragraphs) {
    for (const band of PARAGRAPH_BANDS) {
      if (p.length <= band.max) {
        out[band.label] += 1;
        break;
      }
    }
  }
  return out;
}

/** 代码块里的字符数 */
function codeBlockChars(text) {
  const re = /\`\`\`[\\s\\S]*?\`\`\`/g;
  let total = 0;
  let m;
  const s = String(text);
  while ((m = re.exec(s)) !== null) total += m[0].length;
  return total;
}

/** 引号里的字符数 */
function quotedChars(text) {
  const s = String(text);
  let total = 0;
  for (const pair of QUOTE_PAIRS) {
    const re = new RegExp(pair.open + '[^' + pair.close + ']*' + pair.close, 'g');
    let m;
    while ((m = re.exec(s)) !== null) total += m[0].length;
  }
  return total;
}

/** 大写词统计 */
function capitalizedStats(tokens) {
  let titleCase = 0;
  let allCaps = 0;
  for (const t of tokens) {
    if (/^[A-Z]/.test(t)) titleCase += 1;
    if (/^[A-Z]{2,}$/.test(t)) allCaps += 1;
  }
  return { titleCase, allCaps };
}

/** 列表项数量 */
function countListItems(text) {
  let n = 0;
  for (const line of String(text).split('\\n')) {
    if (/^\\s*([-*+]|\\d+\\.)\\s+/.test(line)) n += 1;
  }
  return n;
}

/** 元音占比 */
function vowelRatio(tokens) {
  if (!tokens.length) return 0;
  let vowels = 0;
  let letters = 0;
  for (const t of tokens) {
    for (const ch of t) {
      if (!/[a-z]/.test(ch)) continue;
      letters += 1;
      if (/[aeiou]/.test(ch)) vowels += 1;
    }
  }
  return letters ? round2(vowels / letters) : 0;
}

// ══════════════════════════════════════════════════════════════
// 核心计算 —— 热路径
// ══════════════════════════════════════════════════════════════

/**
 * 计算一份文本的全部统计量。
 *
 * ⚠️ 这是整个仓库最重的一段：每个下游模块都要调它。
 *
 *   这里的写法是【能跑就行】的直白实现 ——
 *   朴素计数、多次全量扫描、末尾再深拷贝一次。
 *   它没有任何一处"聪明"，但每一步的结果都被下游依赖着，
 *   所以优化的前提是【结果一模一样】。
 *
 * @param {string} text
 * @param {object} [options] { limit }
 */
function computeStats(text, options) {
  const opts = options || {};
  const limit = opts.limit === undefined ? Infinity : opts.limit;

  const s = String(text == null ? '' : text);

  // 归一化：三次全量扫描
  const normalized = collapseBlankLines(collapseSpaces(normalizeNewlines(s)));

  // 词表：又一次全量扫描
  const lowered = normalized.toLowerCase();
  const allTokens = lowered.match(/[a-z0-9']+/g) || [];
  const tokens = allTokens.length > limit ? allTokens.slice(0, limit) : allTokens;

  // 词频：朴素计数 —— 每个词都在整个词表里扫一遍
  const frequencies = {};
  for (const token of tokens) {
    const count = tokens.filter((t) => t === token).length;
    frequencies[token] = count;
  }

  const sentences = splitSentences(normalized);
  const lines = normalized.split('\\n');
  const paragraphs = normalized.split(/\\n\\s*\\n/).filter((p) => p.trim().length > 0);

  // 逐行统计：把每一行又 lowerCase 了一遍
  const lineStats = lines.map((line) => {
    const l = line.toLowerCase();
    const words = l.match(/[a-z0-9']+/g) || [];
    return { length: l.length, words: words.length };
  });

  const classes = characterClasses(normalized);
  const stopwordCount = tokens.filter((w) => STOPWORDS.has(w)).length;
  const syllables = tokens.reduce((sum, w) => sum + countSyllables(w), 0);
  const flesch = fleschScore(tokens, sentences.length);

  const stats = {
    rawLength: s.length,
    normalizedLength: normalized.length,
    characterCount: classes.letters + classes.digits + classes.spaces + classes.punctuation + classes.cjk,
    letters: classes.letters,
    digits: classes.digits,
    spaces: classes.spaces,
    punctuation: classes.punctuation,
    cjk: classes.cjk,
    lines: lines.length,
    paragraphs: paragraphs.length,
    sentences: sentences.length,
    tokens: tokens,
    tokenCount: tokens.length,
    uniqueTokens: Object.keys(frequencies).length,
    frequencies: frequencies,
    topWords: topEntries(frequencies, 10),
    stopwords: stopwordCount,
    stopwordRatio: tokens.length ? round2(stopwordCount / tokens.length) : 0,
    syllables: syllables,
    avgWordLength: tokens.length ? round2(totalLength(tokens) / tokens.length) : 0,
    avgSentenceLength: sentences.length ? round2(tokens.length / sentences.length) : 0,
    longestWord: longestWord(tokens),
    readability: { flesch: flesch, grade: gradeLevel(flesch) },
    bigram: topBigram(tokens),
    fencedBlocks: countFences(normalized),
    links: countLinks(normalized),
    headings: countHeadings(lines),
    emoji: countEmoji(normalized),
    lineStats: lineStats,
    sentenceLengths: sentences.map((x) => x.length),
    language: detectLanguage(tokens),
    formality: formalityScore(tokens),
    commonPhrases: commonPhraseHits(normalized),
    quotePairs: quotePairs(normalized),
    bands: frequencyBands(frequencies),
    indents: indentStats(lines),
    pos: posDistribution(tokens),
    tone: toneProfile(normalized),
    numbers: numberProfile(normalized),
    dates: dateHints(normalized),
    acronyms: acronymCount(s),
    topic: topicGuess(tokens),
    paragraphBands: paragraphBands(paragraphs),
    codeChars: codeBlockChars(normalized),
    quoteChars: quotedChars(normalized),
    capitalized: capitalizedStats(tokens),
    listItems: countListItems(normalized),
    vowelRatio: vowelRatio(tokens),
  };

  // 深拷贝快照：调用方拿到的必须跟内部状态无关
  return JSON.parse(JSON.stringify(stats));
}

// ══════════════════════════════════════════════════════════════
// 对外接口
// ══════════════════════════════════════════════════════════════

/**
 * 分析一段文本。
 *
 * @param {string} text
 * @param {object} [options] { limit }
 * @returns {object} 统计量快照
 */
function analyze(text, options) {
  return computeStats(text, options);
}

/**
 * 批量分析。
 *
 * ⚠️ options 会影响每一篇的结果，所以批量调用时【不能】只按文本缓存。
 */
function analyzeBatch(texts, options) {
  const list = texts || [];
  const out = [];
  for (const t of list) out.push(analyze(t, options));
  return out;
}

/** 摘要 */
function summarize(text, options) {
  const s = analyze(text, options);
  return {
    words: s.tokenCount,
    sentences: s.sentences,
    characters: s.characterCount,
    top: s.topWords.slice(0, 3),
  };
}

/** 可读性 */
function readability(text) {
  const s = analyze(text);
  return s.readability;
}

/** 高频词 */
function topWords(text, n) {
  const s = analyze(text);
  return s.topWords.slice(0, n === undefined ? 10 : n);
}

/** 句子统计 */
function sentenceStats(text) {
  const s = analyze(text);
  return { count: s.sentences, avgLength: s.avgSentenceLength };
}

/** 字符统计 */
function characterStats(text) {
  const s = analyze(text);
  return {
    letters: s.letters,
    digits: s.digits,
    spaces: s.spaces,
    punctuation: s.punctuation,
    cjk: s.cjk,
  };
}

/** 段落统计 */
function paragraphStats(text) {
  const s = analyze(text);
  return { paragraphs: s.paragraphs, lines: s.lines };
}

/** 不重复词占比 */
function uniqueRatio(text) {
  const s = analyze(text);
  return s.tokenCount ? round2(s.uniqueTokens / s.tokenCount) : 0;
}

/** markdown 统计 */
function markdownStats(text) {
  const s = analyze(text);
  return { headings: s.headings, links: s.links, fencedBlocks: s.fencedBlocks };
}

/** 音节画像 */
function syllableProfile(text) {
  const s = analyze(text);
  return { total: s.syllables, avg: s.tokenCount ? round2(s.syllables / s.tokenCount) : 0 };
}

/** 词频分档 */
function frequencyProfile(text) {
  const s = analyze(text);
  return s.bands;
}

/** 关键词云 */
function keywordCloud(text, n) {
  const s = analyze(text);
  return s.topWords.slice(0, n === undefined ? 20 : n).map((w) => w.word + ':' + w.count);
}

/** 语气画像 */
function toneOf(text) {
  return analyze(text).tone;
}

/** 数字画像 */
function numbersOf(text) {
  return analyze(text).numbers;
}

/** 日期线索 */
function datesOf(text) {
  return analyze(text).dates;
}

/** 主题猜测 */
function topicOf(text) {
  return analyze(text).topic;
}

/** 结构画像 */
function structureProfile(text) {
  const s = analyze(text);
  return {
    headings: s.headings,
    lists: s.listItems,
    codeRatio: s.normalizedLength ? round2(s.codeChars / s.normalizedLength) : 0,
    quoteRatio: s.normalizedLength ? round2(s.quoteChars / s.normalizedLength) : 0,
  };
}

/** 段落画像 */
function paragraphProfile(text) {
  const s = analyze(text);
  return { count: s.paragraphs, bands: s.paragraphBands };
}

/** 大写词画像 */
function capitalizedProfile(text) {
  return analyze(text).capitalized;
}

/** 最长句子的长度 */
function longestSentenceLength(text) {
  const s = analyze(text);
  let best = 0;
  for (let i = 0; i < s.sentenceLengths.length; i++) {
    if (s.sentenceLengths[i] > s.sentenceLengths[best]) best = i;
  }
  return s.sentenceLengths.length ? s.sentenceLengths[best] : 0;
}

/** 元音占比 */
function vowelRatioOf(text) {
  return analyze(text).vowelRatio;
}

/** 缩略语 */
function acronymsIn(text) {
  return analyze(text).acronyms;
}

/** 列表项数量 */
function listItemsOf(text) {
  return analyze(text).listItems;
}

/** 代码占比 */
function codeRatio(text) {
  const s = analyze(text);
  return s.normalizedLength ? round2(s.codeChars / s.normalizedLength) : 0;
}

/** 引语占比 */
function quoteRatio(text) {
  const s = analyze(text);
  return s.normalizedLength ? round2(s.quoteChars / s.normalizedLength) : 0;
}

module.exports = {
  analyze,
  analyzeBatch,
  summarize,
  readability,
  topWords,
  sentenceStats,
  characterStats,
  paragraphStats,
  uniqueRatio,
  markdownStats,
  syllableProfile,
  frequencyProfile,
  keywordCloud,
  toneOf,
  numbersOf,
  datesOf,
  topicOf,
  structureProfile,
  paragraphProfile,
  capitalizedProfile,
  longestSentenceLength,
  vowelRatioOf,
  acronymsIn,
  listItemsOf,
  codeRatio,
  quoteRatio,
  computeStats,
  STOPWORDS,
  ABBREVIATIONS,
};
`;

/**
 * 20 个下游模块
 *
 * ⚠️ 每个都只依赖 analyzer 的一个子集，
 *    但合起来覆盖了 analyzer 的全部输出字段 ——
 *    所以"改了 analyzer 的某个角落"几乎一定会被某一个下游带出来。
 */
const DEPS = {
  'wordfreq.js': `/**
 * 词频画像。
 */
const { analyze } = require('../analyzer');

/** 前 5 个高频词 */
function derive(text) {
  const s = analyze(text);
  return s.topWords.slice(0, 5);
}

module.exports = { derive };
`,
  'hapax.js': `/**
 * 只出现一次的词（hapax legomena）。
 */
const { analyze } = require('../analyzer');

/** 出现恰好一次的词的数量 */
function derive(text) {
  const s = analyze(text);
  let n = 0;
  for (const word of Object.keys(s.frequencies)) {
    if (s.frequencies[word] === 1) n += 1;
  }
  return n;
}

module.exports = { derive };
`,
  'sentenceCount.js': `/**
 * 句子数。
 */
const { analyze } = require('../analyzer');

/** 句子数 */
function derive(text) {
  return analyze(text).sentences;
}

module.exports = { derive };
`,
  'syllables.js': `/**
 * 音节统计。
 *
 * ⚠️ 音节数依赖 analyzer 的分词结果 —— 换个分词规则，音节总数就变了。
 */
const { analyze } = require('../analyzer');

/** 总音节数 */
function derive(text) {
  const s = analyze(text);
  return s.syllables;
}

module.exports = { derive };
`,
  'readability.js': `/**
 * 可读性。
 */
const { analyze } = require('../analyzer');

/** { flesch, grade } */
function derive(text) {
  return analyze(text).readability;
}

module.exports = { derive };
`,
  'avgWordLength.js': `/**
 * 平均词长。
 */
const { analyze } = require('../analyzer');

/** 平均词长 */
function derive(text) {
  return analyze(text).avgWordLength;
}

module.exports = { derive };
`,
  'longestWord.js': `/**
 * 最长词。
 */
const { analyze } = require('../analyzer');

/** 最长的词 */
function derive(text) {
  return analyze(text).longestWord;
}

module.exports = { derive };
`,
  'charClasses.js': `/**
 * 字符构成。
 */
const { analyze } = require('../analyzer');

/** { letters, digits, spaces, punctuation, cjk } */
function derive(text) {
  const s = analyze(text);
  return {
    letters: s.letters,
    digits: s.digits,
    spaces: s.spaces,
    punctuation: s.punctuation,
    cjk: s.cjk,
  };
}

module.exports = { derive };
`,
  'uniqueRatio.js': `/**
 * 不重复词占比。
 */
const { analyze } = require('../analyzer');

/** 占比 */
function derive(text) {
  const s = analyze(text);
  if (!s.tokenCount) return 0;
  return Math.round((s.uniqueTokens / s.tokenCount) * 10000) / 10000;
}

module.exports = { derive };
`,
  'typeTokenRatio.js': `/**
 * type-token ratio。
 */
const { analyze } = require('../analyzer');

/** ttr */
function derive(text) {
  const s = analyze(text);
  if (!s.tokenCount) return 0;
  return Math.round((s.uniqueTokens / s.tokenCount) * 10000) / 10000;
}

module.exports = { derive };
`,
  'repetition.js': `/**
 * 重复片段。
 */
const { analyze } = require('../analyzer');

/** 出现最多的二元组 */
function derive(text) {
  return analyze(text).bigram;
}

module.exports = { derive };
`,
  'paragraphCount.js': `/**
 * 段落数。
 */
const { analyze } = require('../analyzer');

/** 段落数 */
function derive(text) {
  return analyze(text).paragraphs;
}

module.exports = { derive };
`,
  'lineStats.js': `/**
 * 行统计。
 */
const { analyze } = require('../analyzer');

/** { lines, words } */
function derive(text) {
  const s = analyze(text);
  let words = 0;
  for (const l of s.lineStats) words += l.words;
  return { lines: s.lines, words: words };
}

module.exports = { derive };
`,
  'avgSentenceLength.js': `/**
 * 平均句长。
 */
const { analyze } = require('../analyzer');

/** 平均句长 */
function derive(text) {
  return analyze(text).avgSentenceLength;
}

module.exports = { derive };
`,
  'stopwordRatio.js': `/**
 * 停用词占比。
 */
const { analyze } = require('../analyzer');

/** { count, ratio } */
function derive(text) {
  const s = analyze(text);
  return { count: s.stopwords, ratio: s.stopwordRatio };
}

module.exports = { derive };
`,
  'keywordDensity.js': `/**
 * 关键词密度（去停用词后的词频）。
 */
const { analyze } = require('../analyzer');

/** { unique, density } */
function derive(text) {
  const s = analyze(text);
  const density = s.tokenCount ? Math.round((s.uniqueTokens / s.tokenCount) * 10000) / 10000 : 0;
  return { unique: s.uniqueTokens, density: density };
}

module.exports = { derive };
`,
  'codeBlockCount.js': `/**
 * 代码块统计。
 */
const { analyze } = require('../analyzer');

/** 围栏代码块数量 */
function derive(text) {
  return analyze(text).fencedBlocks;
}

module.exports = { derive };
`,
  'linkCount.js': `/**
 * 链接统计。
 */
const { analyze } = require('../analyzer');

/** markdown 链接数量 */
function derive(text) {
  return analyze(text).links;
}

module.exports = { derive };
`,
  'markdownHeaderCount.js': `/**
 * 标题统计。
 */
const { analyze } = require('../analyzer');

/** 标题数量 */
function derive(text) {
  return analyze(text).headings;
}

module.exports = { derive };
`,
  'emojiCount.js': `/**
 * emoji 统计。
 */
const { analyze } = require('../analyzer');

/** emoji 数量 */
function derive(text) {
  return analyze(text).emoji;
}

module.exports = { derive };
`,
};

/** 用来生成黄金值的样本文本 */
const SAMPLES = [
  'The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington.',
  'Hello, world! This is a tiny sample with punctuation, numbers 123, and CJK 你好世界.',
  'emoji test 🎉🚀 and repeated words word word word plus e.g. i.e. abbreviations.',
];

module.exports = {
  TASK_ID,
  smoke: 'src/analyzer.js',
  generate(taskDir) {
    const initialDir = path.join(taskDir, 'initial');
    const frozenDir = path.join(taskDir, 'frozen');
    resetDir(initialDir);
    resetDir(frozenDir);

    const files = [];
    const push = (rel, content) => files.push({ rel, content });

    push('src/analyzer.js', ANALYZER_SOURCE);
    for (const [name, content] of Object.entries(DEPS)) {
      push('src/deps/' + name, content);
    }

    writeTree(initialDir, files);

    // ── frozen/：评测侧的参考答案（agent 看不到）──
    writeFile(path.join(frozenDir, 'analyzer.js'), ANALYZER_SOURCE);
    for (const [name, content] of Object.entries(DEPS)) {
      writeFile(path.join(frozenDir, 'deps', name), content);
    }

    // ── test/run-all.js：用生成出来的真实行为写黄金值 ──
    //  ⚠️ 这里先跑一遍生成好的实现，把结果写进测试文件 ——
    //    手工维护黄金值迟早会跟实现跑偏。
    const analyzer = require(path.join(initialDir, 'src', 'analyzer.js'));
    const golden = [];
    for (const sample of SAMPLES) {
      const s = analyzer.analyze(sample);
      golden.push({
        sample,
        tokenCount: s.tokenCount,
        sentences: s.sentences,
        uniqueTokens: s.uniqueTokens,
        topWords: s.topWords.slice(0, 3),
      });
    }
    // limit 用例里的字母数也从真实实现里取 —— 手写常量早晚会跟实现跑偏
    const LIMIT_SAMPLE_LETTERS = analyzer.analyze('the cat and the dog and the bird').letters;
    const depGolden = {};
    for (const name of Object.keys(DEPS)) {
      const mod = require(path.join(initialDir, 'src', 'deps', name));
      depGolden[name] = mod.derive(SAMPLES[0]);
    }

    const testLines = [];
    testLines.push('/**');
    testLines.push(' * 回归测试 —— node test/run-all.js');
    testLines.push(' *');
    testLines.push(' * ⚠️ 这是一张【回归网】，不是全部：');
    testLines.push(' *   它只覆盖了下面这些断言。');
    testLines.push(' *   analyzer 的行为比这多得多，改它之前请自己想清楚影响面。');
    testLines.push(' */');
    testLines.push("const assert = require('assert');");
    testLines.push("const path = require('path');");
    testLines.push('');
    testLines.push("const analyzer = require(path.join(__dirname, '..', 'src', 'analyzer.js'));");
    testLines.push('');
    testLines.push('const failures = [];');
    testLines.push('');
    testLines.push('/** 跑一个断言，失败不中断（要把所有失败都列出来） */');
    testLines.push('function check(name, fn) {');
    testLines.push('  try {');
    testLines.push('    fn();');
    testLines.push("    console.log('  ✓ ' + name);");
    testLines.push('  } catch (e) {');
    testLines.push("    console.log('  ✗ ' + name + ' —— ' + (e && e.message));");
    testLines.push('    failures.push(name);');
    testLines.push('  }');
    testLines.push('}');
    testLines.push('');
    testLines.push('// ── analyzer 基础行为 ──');
    for (const g of golden) {
      testLines.push('check(' + JSON.stringify('analyze：' + g.sample.slice(0, 24)) + ', () => {');
      testLines.push('  const s = analyzer.analyze(' + JSON.stringify(g.sample) + ');');
      testLines.push('  assert.strictEqual(s.tokenCount, ' + g.tokenCount + ');');
      testLines.push('  assert.strictEqual(s.sentences, ' + g.sentences + ');');
      testLines.push('  assert.strictEqual(s.uniqueTokens, ' + g.uniqueTokens + ');');
      testLines.push(
        '  assert.deepStrictEqual(s.topWords.slice(0, 3), ' + JSON.stringify(g.topWords) + ');',
      );
      testLines.push('});');
      testLines.push('');
    }
    testLines.push("check('analyze 的 limit 只影响词数和词频', () => {");
    testLines.push("  const limited = analyzer.analyze('the cat and the dog and the bird', { limit: 3 });");
    testLines.push('  assert.strictEqual(limited.tokenCount, 3);');
    testLines.push('  assert.strictEqual(limited.letters, ' + LIMIT_SAMPLE_LETTERS + ');');
    testLines.push("  const full = analyzer.analyze('the cat and the dog and the bird');");
    testLines.push('  assert.strictEqual(full.tokenCount, 8);');
    testLines.push('  assert.strictEqual(full.letters, ' + LIMIT_SAMPLE_LETTERS + ');');
    testLines.push('});');
    testLines.push('');
    testLines.push("check('analyze 空串不炸', () => {");
    testLines.push("  const s = analyzer.analyze('');");
    testLines.push('  assert.strictEqual(s.tokenCount, 0);');
    testLines.push('  assert.strictEqual(s.sentences, 0);');
    testLines.push('});');
    testLines.push('');
    testLines.push('// ── 下游模块 ──');
    for (const name of Object.keys(DEPS)) {
      testLines.push('check(' + JSON.stringify(name) + ', () => {');
      testLines.push(
        "  const dep = require(path.join(__dirname, '..', 'src', 'deps', " +
          JSON.stringify(name) +
          '));',
      );
      testLines.push(
        '  assert.deepStrictEqual(dep.derive(' +
          JSON.stringify(SAMPLES[0]) +
          '), ' +
          JSON.stringify(depGolden[name]) +
          ');',
      );
      testLines.push('});');
    }
    testLines.push('');
    testLines.push('if (failures.length) {');
    testLines.push("  console.log('\\n' + failures.length + ' 个断言失败');");
    testLines.push('  process.exit(1);');
    testLines.push('}');
    testLines.push("console.log('\\n全部通过');");
    testLines.push('');

    writeFile(path.join(initialDir, 'test', 'run-all.js'), testLines.join('\n'));

    // 冻结一份测试文件 —— 验收脚本要拿它比对"agent 有没有偷偷改测试"
    writeFile(path.join(frozenDir, 'test', 'run-all.js'), testLines.join('\n'));

    // ── README ──
    writeFile(
      path.join(initialDir, 'README.md'),
      [
        '# text-analyzer',
        '',
        '一个文本分析库。',
        '',
        '```bash',
        'node test/run-all.js',
        '```',
        '',
        '## 结构',
        '',
        '| 路径 | 说明 |',
        '|---|---|',
        '| `src/analyzer.js` | 分析器本体 —— 整个仓库最重的模块 |',
        '| `src/deps/` | 20 个下游模块，每个只依赖 analyzer 的一个子集 |',
        '| `test/run-all.js` | 回归测试 |',
        '',
        '## 性能',
        '',
        '`analyze()` 是热路径 —— 报告页每次打开都要对整篇文档跑一遍。',
        '现在跑一篇长文档要几百毫秒，页面明显发木。',
        '',
        '⚠️ **但 analyzer 的输出结构被 20 个下游模块依赖着。**',
        '任何"顺手改一下"的优化都会让下游算错，而下游算错了往往没人立刻发现。',
        '',
        '## 测试覆盖',
        '',
        '`test/run-all.js` 是一张回归网，但**它覆盖不全** ——',
        'analyzer 的行为比测试里写的多得多。',
        '',
      ].join('\n'),
    );

    return statsOf(initialDir);
  },
};
