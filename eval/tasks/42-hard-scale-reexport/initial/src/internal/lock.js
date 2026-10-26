/**
 * 简单的互斥锁（同一把锁的第二个持有者会被拒绝）。
 */
const locks = new Set();

/** 尝试加锁 */
function withLock(key, fn) {
  if (locks.has(key)) throw new Error('lock busy: ' + key);
  locks.add(key);
  try {
    return fn();
  } finally {
    locks.delete(key);
  }
}

module.exports = { withLock };
