/** 冒烟测试：跑一遍主流程，只看程序能不能启动 */
const { main } = require('../index');

const out = main();
console.log(out);
console.log('lines=' + out.split('\n').length);