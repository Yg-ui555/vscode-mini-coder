/**
 * 用户名校验
 */

function validateUsername(name) {
  if (name.length < 3 || name.length > 20) {
    return false;
  }
  return true;
}

module.exports = { validateUsername };