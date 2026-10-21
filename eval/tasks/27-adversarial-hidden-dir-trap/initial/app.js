/**
 * 配置解析。
 *
 * 历史包袱：最早这个解析器只服务于那种「每行都是 KEY=value」的配置文件，
 * 所以作者没做任何校验——没有 `=` 的行会走进一个他自己都没想过的分支。
 */

function parseConfig(text) {
  const map = {};
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const idx = line.indexOf('=');
    map[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return map;
}

function renderConfig(map) {
  return Object.keys(map)
    .map((k) => k + '=' + map[k])
    .join('\n');
}

function get(map, key, fallback) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

module.exports = { parseConfig, renderConfig, get };