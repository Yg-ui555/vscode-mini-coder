/**
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
  money: /[$¥€]\s?\d[\d,]*(?:\.\d+)?/g,
  percent: /\d+(?:\.\d+)?%/g,
  year: /\b(?:19|20)\d{2}\b/g,
  decimal: /\b\d+\.\d+\b/g,
};

/**
 * 日期格式 —— 三种常见的写法。
 */
const DATE_PATTERNS = {
  iso: /\b\d{4}-\d{2}-\d{2}\b/g,
  slash: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  chinese: /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g,
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
 * ⚠️ 必须先处理 \r\n 再处理单独的 \r ——
 *    顺序反了会把 "\r\n" 变成两个换行。
 */
function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** 把连续空格和 Tab 压成一个空格 */
function collapseSpaces(text) {
  return String(text).replace(/[ \t]+/g, ' ');
}

/** 把三个以上的连续换行压成两个 */
function collapseBlankLines(text) {
  return String(text).replace(/\n{3,}/g, '\n\n');
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
  const raw = String(text).split(/(?<=[.!?])\s+/);
  const out = [];
  for (const piece of raw) {
    if (out.length === 0) {
      out.push(piece);
      continue;
    }
    const last = out[out.length - 1];
    const tail = last.split(/\s+/).pop() || '';
    const bare = tail.replace(/\.$/, '').toLowerCase();
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
const CJK_PATTERN = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

function characterClasses(text) {
  let letters = 0;
  let digits = 0;
  let spaces = 0;
  let punctuation = 0;
  let cjk = 0;
  for (const ch of String(text)) {
    if (/\s/.test(ch)) spaces += 1;
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
  const fences = String(text).match(/```/g) || [];
  return Math.floor(fences.length / 2);
}

/** markdown 链接数量 */
function countLinks(text) {
  return (String(text).match(/\[[^\]]*\]\([^)]*\)/g) || []).length;
}

/** markdown 标题数量 */
function countHeadings(lines) {
  let n = 0;
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) n += 1;
  }
  return n;
}

/**
 * emoji 数量。
 *
 * ⚠️ 用了 /g 的正则 + match —— match 会重置 lastIndex，所以是安全的。
 */
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F2FF}]/gu;

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
    const m = /^(\s+)/.exec(line);
    if (!m) continue;
    const width = m[1].replace(/\t/g, '  ').length;
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
  const matches = String(text).match(/[A-Z]{2,}/g) || [];
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
  const re = /```[\s\S]*?```/g;
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
  for (const line of String(text).split('\n')) {
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) n += 1;
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
  const lines = normalized.split('\n');
  const paragraphs = normalized.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

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
