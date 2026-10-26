/**
 * 清理任务。
 */

/** 找出过期条目 */
function expired(items, now, ttl) {
  const cutoff = (now === undefined ? Date.now() : now) - ttl;
  return (items || []).filter((it) => it.at < cutoff);
}

module.exports = { expired };
