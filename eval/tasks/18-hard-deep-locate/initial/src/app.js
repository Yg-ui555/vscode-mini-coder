const audit = require('./services/audit/format');
const legacy = require('./legacy/v1/render/format');

const RECORDS = [
  { time: '09:00', actor: 'alice', action: 'login' },
  { time: '09:05', action: 'logout' },
];

function auditPage() {
  return RECORDS.map(audit.auditLine).join('\n');
}

function legacyPage() {
  return [legacy.formatName('  Bob '), legacy.formatName('   '), legacy.formatRole('Admin')].join('|');
}

module.exports = { RECORDS, auditPage, legacyPage };