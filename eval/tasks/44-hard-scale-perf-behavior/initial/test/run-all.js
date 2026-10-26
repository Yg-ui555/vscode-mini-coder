/**
 * 回归测试 —— node test/run-all.js
 *
 * ⚠️ 这是一张【回归网】，不是全部：
 *   它只覆盖了下面这些断言。
 *   analyzer 的行为比这多得多，改它之前请自己想清楚影响面。
 */
const assert = require('assert');
const path = require('path');

const analyzer = require(path.join(__dirname, '..', 'src', 'analyzer.js'));

const failures = [];

/** 跑一个断言，失败不中断（要把所有失败都列出来） */
function check(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
  } catch (e) {
    console.log('  ✗ ' + name + ' —— ' + (e && e.message));
    failures.push(name);
  }
}

// ── analyzer 基础行为 ──
check("analyze：The quick brown fox jump", () => {
  const s = analyzer.analyze("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington.");
  assert.strictEqual(s.tokenCount, 14);
  assert.strictEqual(s.sentences, 2);
  assert.strictEqual(s.uniqueTokens, 13);
  assert.deepStrictEqual(s.topWords.slice(0, 3), [{"word":"the","count":2},{"word":"quick","count":1},{"word":"brown","count":1}]);
});

check("analyze：Hello, world! This is a ", () => {
  const s = analyzer.analyze("Hello, world! This is a tiny sample with punctuation, numbers 123, and CJK 你好世界.");
  assert.strictEqual(s.tokenCount, 13);
  assert.strictEqual(s.sentences, 2);
  assert.strictEqual(s.uniqueTokens, 13);
  assert.deepStrictEqual(s.topWords.slice(0, 3), [{"word":"123","count":1},{"word":"hello","count":1},{"word":"world","count":1}]);
});

check("analyze：emoji test 🎉🚀 and repe", () => {
  const s = analyzer.analyze("emoji test 🎉🚀 and repeated words word word word plus e.g. i.e. abbreviations.");
  assert.strictEqual(s.tokenCount, 14);
  assert.strictEqual(s.sentences, 1);
  assert.strictEqual(s.uniqueTokens, 11);
  assert.deepStrictEqual(s.topWords.slice(0, 3), [{"word":"word","count":3},{"word":"e","count":2},{"word":"emoji","count":1}]);
});

check('analyze 的 limit 只影响词数和词频', () => {
  const limited = analyzer.analyze('the cat and the dog and the bird', { limit: 3 });
  assert.strictEqual(limited.tokenCount, 3);
  assert.strictEqual(limited.letters, 25);
  const full = analyzer.analyze('the cat and the dog and the bird');
  assert.strictEqual(full.tokenCount, 8);
  assert.strictEqual(full.letters, 25);
});

check('analyze 空串不炸', () => {
  const s = analyzer.analyze('');
  assert.strictEqual(s.tokenCount, 0);
  assert.strictEqual(s.sentences, 0);
});

// ── 下游模块 ──
check("wordfreq.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "wordfreq.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), [{"word":"the","count":2},{"word":"quick","count":1},{"word":"brown","count":1},{"word":"fox","count":1},{"word":"jumps","count":1}]);
});
check("hapax.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "hapax.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), 12);
});
check("sentenceCount.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "sentenceCount.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), 2);
});
check("syllables.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "syllables.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), 18);
});
check("readability.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "readability.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), {"flesch":90.96,"grade":"A"});
});
check("avgWordLength.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "avgWordLength.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), 4.14);
});
check("longestWord.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "longestWord.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), "washington");
});
check("charClasses.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "charClasses.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), {"letters":58,"digits":0,"spaces":13,"punctuation":3,"cjk":0});
});
check("uniqueRatio.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "uniqueRatio.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), 0.9286);
});
check("typeTokenRatio.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "typeTokenRatio.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), 0.9286);
});
check("repetition.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "repetition.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), {"text":"the quick","count":1});
});
check("paragraphCount.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "paragraphCount.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), 1);
});
check("lineStats.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "lineStats.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), {"lines":1,"words":14});
});
check("avgSentenceLength.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "avgSentenceLength.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), 7);
});
check("stopwordRatio.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "stopwordRatio.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), {"count":4,"ratio":0.29});
});
check("keywordDensity.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "keywordDensity.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), {"unique":13,"density":0.9286});
});
check("codeBlockCount.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "codeBlockCount.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), 0);
});
check("linkCount.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "linkCount.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), 0);
});
check("markdownHeaderCount.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "markdownHeaderCount.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), 0);
});
check("emojiCount.js", () => {
  const dep = require(path.join(__dirname, '..', 'src', 'deps', "emojiCount.js"));
  assert.deepStrictEqual(dep.derive("The quick brown fox jumps over the lazy dog. Dr. Smith went to Washington."), 0);
});

if (failures.length) {
  console.log('\n' + failures.length + ' 个断言失败');
  process.exit(1);
}
console.log('\n全部通过');
