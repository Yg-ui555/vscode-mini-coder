const { legacyFormat } = require('./format');

const ITEMS = [
  { sku: 'A-1', price: 1250 },
  { sku: 'B-7', price: 999 },
  { sku: 'C-3', price: 100 },
];

function lineFor(item) {
  return item.sku + ' ' + legacyFormat(item.price);
}

function checkout() {
  const total = ITEMS.reduce((s, i) => s + i.price, 0);
  return ITEMS.map(lineFor).join('\n') + '\ntotal ' + legacyFormat(total);
}

module.exports = { ITEMS, lineFor, checkout };