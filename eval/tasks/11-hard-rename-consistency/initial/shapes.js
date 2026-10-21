/**
 * 图形类定义
 *
 * 说明：'circle' / 'square' 是对外的业务标签（会出现在报表里），
 * 和类名是两回事，重命名类的时候不要动它们。
 */

class Circle {
  constructor(radius) {
    this.radius = Number(radius);
  }

  type() {
    return 'circle';
  }

  area() {
    return Math.PI * this.radius ** 2;
  }

  perimeter() {
    return 2 * Math.PI * this.radius;
  }

  scale(k) {
    return new Circle(this.radius * k);
  }

  toString() {
    return `circle(r=${this.radius})`;
  }
}

class Square {
  constructor(side) {
    this.side = Number(side);
  }

  type() {
    return 'square';
  }

  area() {
    return this.side ** 2;
  }

  perimeter() {
    return 4 * this.side;
  }

  scale(k) {
    return new Square(this.side * k);
  }

  toString() {
    return `square(s=${this.side})`;
  }
}

module.exports = { Circle, Square };