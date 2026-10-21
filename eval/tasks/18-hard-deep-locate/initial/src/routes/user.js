const profile = require('../services/account/profile/format');

const USERS = [
  { name: '张三', handle: 'zhangsan' },
  { name: '  李四  ', handle: 'lisi' },
  { name: '   ', handle: 'nobody' },
  { handle: 'ghost' },
];

function userRow(user) {
  return profile.profileLine(user) + ' ' + profile.initials(user);
}

function userPage() {
  return USERS.map(userRow).join('\n');
}

module.exports = { USERS, userRow, userPage };