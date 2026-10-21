const { legacyFormat } = require('../format');

const ROWS = [
  { ref: 'INV-1', due: 4500 },
  { ref: 'INV-2', due: 1 },
];

function dueLine(row) {
  return row.ref + ' due ' + legacyFormat(row.due);
}

function invoice() {
  return ROWS.map(dueLine).join('\n');
}

module.exports = { ROWS, dueLine, invoice };