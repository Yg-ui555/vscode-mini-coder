/**
 * 特性开关。
 */
const flags = new Set(['export-v2']);

/** 是否开启 */
function featureFlags(name) {
  return flags.has(name);
}

/** 打开开关 */
function enableFeature(name) {
  flags.add(name);
}

module.exports = { featureFlags, enableFeature };
