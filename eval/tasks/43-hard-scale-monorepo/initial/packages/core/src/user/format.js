/**
 * 用户显示格式化。
 *
 * ⚠️ 目前只认一种风格（full）。app 包里有不少调用点【已经在传第二个参数】了，
 *    但这个函数一直把它忽略了 —— 也就是说那些调用点渲染出来的结果
 *    跟调用方【以为的】不一样，而且从头到尾没有任何报错。
 *
 *    这个"静默"才是问题：调用方以为在用紧凑样式，实际拿到的是完整样式。
 */
function formatUser(user) {
  const name = String((user && user.name) || '');
  const age = Number((user && user.age) || 0);
  return name + ' (' + age + '岁)';
}

/**
 * 已废弃的别名 —— 老代码还在用它。
 *
 * ⚠️ 它内部调的就是 formatUser，所以改签名的时候它也得跟着改。
 */
function formatUsername(user) {
  return formatUser(user);
}

module.exports = { formatUser, formatUsername };
