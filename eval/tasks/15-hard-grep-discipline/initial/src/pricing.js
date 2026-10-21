const { legacyFormat } = require('./format');

const TIERS = [
  { name: 'free', fee: 0 },
  { name: 'pro', fee: 9900 },
];

function priceTag(tier) {
  return tier.name + '=' + legacyFormat(tier.fee);
}

function priceList() {
  return TIERS.map(priceTag).join(',');
}

module.exports = { TIERS, priceTag, priceList };