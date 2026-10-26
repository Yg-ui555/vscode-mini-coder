/**
 * JSON 工具 —— 全部不抛异常，解析不了就给默认值。
 */

/** 安全解析 */
function safeParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback === undefined ? null : fallback;
  }
}

/** 安全序列化 */
function safeStringify(value, fallback) {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback === undefined ? null : fallback;
  }
}

module.exports = { safeParse, safeStringify };
