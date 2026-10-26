/**
 * core 层汇总 —— 无业务语义的通用函数。
 *
 * ⚠️ 这一层只放通用能力，任何跟业务有关的逻辑都不该出现在这里。
 *
 * ⚠️ 显式列出对外暴露的符号，而不是整个 require 出去 ——
 *    免得内部实现不小心就泄漏成公开 API。
 */
const m_string = require('./string');
const m_number = require('./number');
const m_date = require('./date');
const m_array = require('./array');
const m_object = require('./object');
const m_text = require('./text');
const m_path = require('./path');
const m_hash = require('./hash');
const m_json = require('./json');
const m_color = require('./color');
const m_url = require('./url');
const m_regex = require('./regex');
const m_legacy = require('./legacy');

module.exports = {
  truncate: m_string.truncate,
  padStart: m_string.padStart,
  slugify: m_string.slugify,
  capitalize: m_string.capitalize,
  trim: m_string.trim,
  repeat: m_string.repeat,
  formatBytes: m_number.formatBytes,
  clamp: m_number.clamp,
  parseRange: m_number.parseRange,
  roundTo: m_number.roundTo,
  isInteger: m_number.isInteger,
  toPercent: m_number.toPercent,
  formatDate: m_date.formatDate,
  parseDate: m_date.parseDate,
  addDays: m_date.addDays,
  diffDays: m_date.diffDays,
  startOfDay: m_date.startOfDay,
  chunk: m_array.chunk,
  groupBy: m_array.groupBy,
  unique: m_array.unique,
  flatten: m_array.flatten,
  first: m_array.first,
  last: m_array.last,
  pick: m_object.pick,
  omit: m_object.omit,
  deepMerge: m_object.deepMerge,
  get: m_object.get,
  has: m_object.has,
  truncateWords: m_text.truncateWords,
  wordCount: m_text.wordCount,
  similarity: m_text.similarity,
  normalizeSpace: m_text.normalizeSpace,
  levenshtein: m_text.levenshtein,
  joinPath: m_path.joinPath,
  extname: m_path.extname,
  basename: m_path.basename,
  dirname: m_path.dirname,
  simpleHash: m_hash.simpleHash,
  stableStringify: m_hash.stableStringify,
  safeParse: m_json.safeParse,
  safeStringify: m_json.safeStringify,
  hexToRgb: m_color.hexToRgb,
  rgbToHex: m_color.rgbToHex,
  parseQuery: m_url.parseQuery,
  buildQuery: m_url.buildQuery,
  escapeRegExp: m_regex.escapeRegExp,
  matchAll: m_regex.matchAll,
  legacyTruncate: m_legacy.legacyTruncate,
  legacyPadStart: m_legacy.legacyPadStart,
};
