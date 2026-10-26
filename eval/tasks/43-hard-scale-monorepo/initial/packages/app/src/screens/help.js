/**
 * 帮助页文案。
 */
const HELP = [
  '在搜索框里输入名字可以快速定位成员。',
  '按 / 聚焦搜索框，按 Esc 清空。',
];

/** 取一条帮助文案 */
function helpText(index) {
  return HELP[index % HELP.length];
}

module.exports = { helpText, HELP };
