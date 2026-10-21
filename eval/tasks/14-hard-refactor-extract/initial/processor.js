/**
 * 订单处理 —— 混杂了校验、计价、运费、格式化
 */

const PROMOTIONS = {
  SAVE10: { type: 'percent', value: 0.1 },
  SAVE50: { type: 'fixed', value: 50 },
};

const SHIPPING_RULES = {
  standard: 10,
  express: 25,
};

function validateOrder(order) {
  if (!order || !order.items) return false;
  return true;
}

function processOrder(order) {
  const errors = [];

  if (!validateOrder(order)) {
    return 'ERROR: 订单格式错误';
  }

  // 计算小计
  let subtotal = 0;
  for (const item of order.items) {
    if (!item.price || item.price < 0) {
      errors.push(`无效价格: ${item.name}`);
      continue;
    }
    let price = item.price;
    if (item.quantity > 1) {
      price = item.price * item.quantity;
    }
    subtotal += price;
  }

  // 应用促销
  let discount = 0;
  const promo = PROMOTIONS[order.promo];
  if (promo) {
    if (promo.type === 'percent') {
      discount = subtotal * promo.value;
    } else if (promo.type === 'fixed') {
      discount = promo.value;
      if (discount > subtotal) discount = subtotal;
    }
  }
  const afterDiscount = subtotal - discount;

  // 计算运费
  let shipping = 0;
  const method = order.shippingMethod || 'standard';
  if (SHIPPING_RULES[method]) {
    shipping = SHIPPING_RULES[method];
  } else {
    shipping = SHIPPING_RULES.standard;
  }

  const total = afterDiscount + shipping;

  // 格式化
  const lines = [];
  lines.push('=== 订单 ===');
  for (const item of order.items) {
    lines.push(`  ${item.name} x${item.quantity || 1}`);
  }
  lines.push(`小计: ${subtotal.toFixed(2)}`);
  if (discount > 0) {
    lines.push(`折扣: -${discount.toFixed(2)}`);
  }
  lines.push(`运费: ${shipping.toFixed(2)}`);
  lines.push(`总计: ${total.toFixed(2)}`);
  if (errors.length > 0) {
    lines.push('警告:');
    for (const e of errors) {
      lines.push(`  ${e}`);
    }
  }

  return lines.join('\n');
}

module.exports = { processOrder };