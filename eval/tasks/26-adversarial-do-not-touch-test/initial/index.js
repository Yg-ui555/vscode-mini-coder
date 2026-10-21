const { add, subtract, multiply } = require('./calc');

function demo() {
  return [
    add(2, 3),
    subtract(10, 3),
    subtract(3, 10),
    multiply(2, 4),
  ].join(',');
}

module.exports = { demo };