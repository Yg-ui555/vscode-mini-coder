/**
 * 规模题生成器的公共工具
 *
 * ⭐ 为什么要有这个目录：
 *
 *   这 4 道题（41-44）的【规模】是刻意造出来的 ——
 *   消融实验（eval/ABLATION.md）已经证明，
 *   现有题目只有 5-9 个文件，"通读"就够，规模根本没成为瓶颈。
 *
 *   60 个手写文件既费劲又容易写飘（每个文件的风格慢慢就跑偏了），
 *   所以改成脚本生成：
 *     · 幂等 —— 反复跑结果一样，不会把仓库搞脏
 *     · 一致 —— 几十个结构相似的模块由同一套模板产出，改一处全体跟着改
 *     · 可审计 —— 模板里写清楚了"哪几个文件是故意留的坑"
 *
 * 用法：
 *   node eval/tasks/_gen/scaleTasks.js          # 生成全部 4 道题
 *   node eval/tasks/_gen/scaleTasks.js 41       # 只生成 41
 */

const fs = require('fs');
const path = require('path');

/** eval/tasks 目录 */
const TASKS_DIR = path.join(__dirname, '..');

/**
 * 写文件（统一 UTF-8 + LF）
 *
 * ⚠️ 统一用 LF：仓库里现有的文件都是 LF（没有 .gitattributes 强制 CRLF），
 *   混进 CRLF 会让 diff 看起来像整个文件都变了。
 */
function writeFile(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, String(content).replace(/\r\n/g, '\n'), 'utf-8');
}

/** 重建目录（先删后建 —— 保证脚本幂等） */
function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 把一组 { rel, content } 写进 initial/
 *
 * rel 用正斜杠（跨平台一致）
 */
function writeTree(initialDir, files) {
  for (const f of files) {
    writeFile(path.join(initialDir, f.rel.split('/').join(path.sep)), f.content);
  }
}

/** 给每一行加缩进 */
function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => (l.length ? pad + l : l))
    .join('\n');
}

/** 统计一棵树的文件数 / 行数 / 目录数（生成完自检用） */
function statsOf(dir) {
  let files = 0;
  let lines = 0;
  const dirs = new Set();
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? prefix + '/' + e.name : e.name;
      if (e.isDirectory()) {
        dirs.add(rel);
        walk(path.join(d, e.name), rel);
      } else {
        files += 1;
        lines += fs.readFileSync(path.join(d, e.name), 'utf-8').split('\n').length;
      }
    }
  };
  walk(dir, '');
  return { files, lines, dirs: dirs.size };
}

module.exports = { TASKS_DIR, writeFile, resetDir, writeTree, indent, statsOf };
