/**
 * internal 层汇总 —— 内部能力，不对外承诺稳定性。
 *
 * ⚠️ 这一层直接透传 core，没有做任何替换。
 *
 * ⚠️ 显式列出对外暴露的符号，而不是整个 require 出去 ——
 *    免得内部实现不小心就泄漏成公开 API。
 */
const core = require('../core');
const m_paths = require('./paths');
const m_cache = require('./cache');
const m_lock = require('./lock');
const m_validate = require('./validate');
const m_paginate = require('./paginate');
const m_serialize = require('./serialize');
const m_errors = require('./errors');
const m_feature = require('./feature');

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
  routeOf: m_paths.routeOf,
  joinRoute: m_paths.joinRoute,
  cacheGet: m_cache.cacheGet,
  cacheSet: m_cache.cacheSet,
  cacheClear: m_cache.cacheClear,
  withLock: m_lock.withLock,
  validatePayload: m_validate.validatePayload,
  paginate: m_paginate.paginate,
  serialize: m_serialize.serialize,
  describeError: m_errors.describeError,
  featureFlags: m_feature.featureFlags,
  enableFeature: m_feature.enableFeature,
};
