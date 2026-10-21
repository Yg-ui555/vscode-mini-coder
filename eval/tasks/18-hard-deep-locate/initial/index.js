const user = require('./src/routes/user');
const app = require('./src/app');

function main() {
  return [user.userPage(), app.auditPage(), app.legacyPage()].join('\n---\n');
}

module.exports = { main };

if (require.main === module) {
  console.log(main());
}