/**
 * app 侧 ID。
 */
const { nextId } = require('../../../core/src/util/id');

/** 生成一个会话 ID */
function sessionId(prefix) {
  return (prefix || 's') + '-' + nextId('app');
}

module.exports = { sessionId };
