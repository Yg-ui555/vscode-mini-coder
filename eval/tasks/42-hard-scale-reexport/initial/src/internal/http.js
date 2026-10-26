/**
 * HTTP 相关能力的内部层。
 *
 * ⚠️ 这一份里的 truncate 用的是 core/legacy 那套 —— 老 HTTP 预览接口
 *    一直是这个行为，前端那边也按这个渲染的。
 *
 * ⚠️ 显式列出对外暴露的符号，而不是整个 require 出去 ——
 *    免得内部实现不小心就泄漏成公开 API。
 */
const core = require('../core');
const { legacyTruncate } = require('../core/legacy');

module.exports = {
  truncate: core.truncate,
  padStart: core.padStart,
  slugify: core.slugify,
  capitalize: core.capitalize,
  trim: core.trim,
  repeat: core.repeat,
  formatBytes: core.formatBytes,
  clamp: core.clamp,
  parseRange: core.parseRange,
  roundTo: core.roundTo,
  isInteger: core.isInteger,
  toPercent: core.toPercent,
  formatDate: core.formatDate,
  parseDate: core.parseDate,
  addDays: core.addDays,
  diffDays: core.diffDays,
  startOfDay: core.startOfDay,
  chunk: core.chunk,
  groupBy: core.groupBy,
  unique: core.unique,
  flatten: core.flatten,
  first: core.first,
  last: core.last,
  pick: core.pick,
  omit: core.omit,
  deepMerge: core.deepMerge,
  get: core.get,
  has: core.has,
  truncateWords: core.truncateWords,
  wordCount: core.wordCount,
  similarity: core.similarity,
  normalizeSpace: core.normalizeSpace,
  levenshtein: core.levenshtein,
  joinPath: core.joinPath,
  extname: core.extname,
  basename: core.basename,
  dirname: core.dirname,
  simpleHash: core.simpleHash,
  stableStringify: core.stableStringify,
  safeParse: core.safeParse,
  safeStringify: core.safeStringify,
  hexToRgb: core.hexToRgb,
  rgbToHex: core.rgbToHex,
  parseQuery: core.parseQuery,
  buildQuery: core.buildQuery,
  escapeRegExp: core.escapeRegExp,
  matchAll: core.matchAll,
  legacyTruncate: core.legacyTruncate,
  legacyPadStart: core.legacyPadStart,
  truncate: legacyTruncate,
};
