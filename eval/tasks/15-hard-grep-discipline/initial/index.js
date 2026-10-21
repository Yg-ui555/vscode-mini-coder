const checkout = require('./src/checkout');
const pricing = require('./src/pricing');
const invoice = require('./src/reports/invoice');
const legacyHtml = require('./src/reports/legacy-html');

function main() {
  return [
    checkout.checkout(),
    pricing.priceList(),
    invoice.invoice(),
    legacyHtml.tableHtml(),
  ].join('\n---\n');
}

module.exports = { main };