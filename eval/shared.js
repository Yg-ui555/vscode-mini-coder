/**
 * 评测题共用的断言工具
 *
 * ⭐ 这里存在的理由是一个真实踩过的坑（2026-10-21）：
 *
 *   27 号题原本断言「.notes/ 一个字节都不能被碰」。
 *   结果 agent 调了一次 record_note（记了一条错题本）——那是**产品的正常功能**——
 *   断言就判它 regressed。
 *
 *   这是典型的「测量工具的 bug 比被测对象更可怕」：
 *     · agent 做对了，却被判成弄坏了东西；
 *     · 报告上 pass rate 掉了，第一个反应会是「模型变差了」，
 *       于是去调提示词、换模型——全在错误的方向上使劲；
 *     · 真正的 bug（断言写错了）反而被藏起来了。
 *
 *   所以这里把「哪些目录算 agent 自己的簿记、哪些算用户的项目代码」
 *   明确定义成一份共享真相，而不是每道题各写一个 walker 各判各的。
 */

/**
 * 插件自己的簿记目录 —— 不算用户的项目代码
 *
 * 这两个名字必须和 src/agent/tools/fileScan.ts 的 IGNORED_DIRS 保持一致。
 * 工具层扫描时会跳过它们，所以 agent 不该把它们当成"项目源码"来读/改；
 * 评测断言也必须用同一套口径，否则两边的世界观就对不上了。
 *
 * ⚠️ 两者的性质不同，别一视同仁：
 *   .notes/     agent 自己写的笔记本 —— 写它是【正确行为】（record_note 的本职）
 *   .mini-coder/ checkpoint 存档 —— agent 不该手工改，但评测沙箱里 checkpoint
 *               本来就是关的，所以正常情况下它不会变；真变了才说明有人手贱
 */
const BOOKKEEPING_DIRS = ['.notes', '.mini-coder'];

/** 相对路径是否落在簿记目录里 */
function isBookkeeping(relPath) {
  const first = String(relPath).split('/')[0];
  return BOOKKEEPING_DIRS.includes(first);
}

/**
 * 递归列出文件（相对路径，正斜杠分隔，已排序）
 *
 * @param {string} dir  沙箱根目录
 * @param {object} [opt]
 * @param {boolean} [opt.includeBookkeeping] 是否包含 .notes/ .mini-coder/
 *        默认 false —— 也就是「只列用户的项目文件」，做"有没有乱动项目"断言时用这个
 * @param {function} [opt.filter] 额外的文件过滤（如只看 .js）
 */
function listFiles(dir, opt) {
  const options = opt || {};
  const includeBookkeeping = options.includeBookkeeping === true;
  const out = [];

  const walk = (d, prefix) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? prefix + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (!includeBookkeeping && BOOKKEEPING_DIRS.includes(e.name)) continue;
        walk(path.join(d, e.name), rel);
      } else {
        if (options.filter && !options.filter(rel)) continue;
        out.push(rel);
      }
    }
  };

  walk(dir, '');
  return out.sort();
}

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** 子树指纹：文件名 + 内容一起哈希。文件被改或被增删都会变。 */
function treeSha(dir) {
  const h = crypto.createHash('sha256');
  for (const rel of listFiles(dir, { includeBookkeeping: true })) {
    h.update(rel);
    h.update(fs.readFileSync(path.join(dir, rel)));
  }
  return h.digest('hex').slice(0, 16);
}

/** 单文件 sha256 前 16 位 */
function fileSha(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex')
    .slice(0, 16);
}

module.exports = {
  BOOKKEEPING_DIRS,
  isBookkeeping,
  listFiles,
  treeSha,
  fileSha,
};