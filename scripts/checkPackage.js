#!/usr/bin/env node
/**
 * 打包守卫 —— 断言 VSIX 里没有不该给用户的东西
 *
 * ⭐ 为什么要单独一个文件
 *
 *   vsce（VS Code 官方打包工具）**只读 .vscodeignore，不读 .gitignore**。
 *   这个机制差异导致过一次真实的打包事故：
 *     .gitignore 里排除了 eval/results.json、webview-ui/node_modules，
 *     但 .vscodeignore 没排 —— 于是
 *       · eval/results.json            280 KB（评测原始数据，用户完全用不到）
 *       · eval/baselines/*.json         150 KB（历史基线快照）
 *       · eval/tasks/ 23 道题            ~200 KB（题目和初始代码）
 *       · webview-ui/ 整个前端目录       数十 MB（含 node_modules）
 *     全被塞进发给用户的 VSIX。
 *
 *   用户装一个 30MB 的插件，其中 99% 是开发时的垃圾。
 *
 *   .vscodeignore 里的注释是给人看的，注释会被人忽略。
 *   这个脚本是给 CI 用的 —— 漏了会【红】。
 *
 * ─────────────────────────────────────────────────────────────
 * 用法
 *
 *   npx @vscode/vsce ls > vsce-files.txt
 *   node scripts/checkPackage.js vsce-files.txt
 *
 *   也可以不给参数，直接在 CI 里跑 `npm run check:package`
 *   （内部会自己调 vsce ls）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/** 守卫名（报错前缀） */
const CHECK = 'package';

/**
 * 不该出现在 VSIX 里的路径前缀
 *
 * 注意 skills/ 和 dist-webview/ 是【要保留】的（产品功能），
 * 所以这里只列开发/评测产物。
 */
const FORBIDDEN = [
  { prefix: 'eval/', why: '评测题库和评测产物（用户装插件用不到）' },
  { prefix: 'webview-ui/', why: '前端源码目录（含 node_modules），产物在 dist-webview/' },
  { prefix: 'src/', why: 'TypeScript 源码，编译产物在 out/' },
  { prefix: 'scripts/', why: '开发脚本（checkProject.js 等）' },
  { prefix: 'test_demo.py', why: '临时测试脚本' },
  { prefix: '.github/', why: 'CI 配置，用户不需要' },
  { prefix: '.tmp/', why: '开发期的临时文件（审计日志、探针脚本等）' },
  { prefix: '.claude/', why: '本地编辑器配置' },
  { prefix: 'docs/', why: '个人简历 / 面试材料，属于仓库内容不属于插件' },
  { prefix: 'coverage/', why: '覆盖率 HTML 报告（实测 107 个文件 / 2.7 MB）' },
  { prefix: 'out/__tests__/', why: '⭐ 编译后的测试代码：用户不需要，而且里面有故意伪造的假密钥，会触发 vsce 安全扫描' },
  { prefix: 'out/eval/', why: '评测框架的编译产物，插件运行时用不到' },
  { prefix: '.env', why: '⭐ 密钥文件，绝对不能进包' },
];

/**
 * 必须在包里（否则装完不能用）
 */
const REQUIRED = [
  { prefix: 'package.json', why: '扩展清单' },
  { prefix: 'out/extension.js', why: '扩展主入口' },
  { prefix: 'dist-webview/', why: '聊天面板界面' },
  { prefix: 'skills/', why: '内置技能包' },
];

/** VSIX 体积上限（字节）—— 超过就是又漏了什么 */
const MAX_VSIX_BYTES = 2 * 1024 * 1024; // 2 MB

function readFileList() {
  const arg = process.argv[2];
  if (arg && fs.existsSync(path.resolve(ROOT, arg))) {
    return fs
      .readFileSync(path.resolve(ROOT, arg), 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }
  // 没给文件就自己跑一次 vsce ls
  //
  // ⚠️ Windows 上调 npx 有两个坑，这里两个都踩过：
  //
  //   坑 1：直接 execFileSync('npx', ...)
  //        → "spawnSync npx ENOENT"
  //        Windows 的 npx 实际是 npx.cmd，Node 不解析 .cmd 后缀。
  //
  //   坑 2：改成 execFileSync('npx.cmd', ...)
  //        → "spawnSync npx.cmd EINVAL"
  //        Node 22+（CVE-2024-27980 的加固）禁止不经 shell 直接 spawn .cmd。
  //
  //   用 shell: true 能绕过去，但会打 DEP0190 弃用警告，
  //   而且参数不转义，理论上有注入面。
  //
  //   这里的解法：Windows 上走 cmd.exe /c。
  //     · cmd.exe 是真正的 .exe，不需要 shell:true
  //     · 没有弃用警告
  //     · 参数是写死的常量，不存在注入问题
  const isWin = process.platform === 'win32';
  const out = isWin
    ? execFileSync('cmd.exe', ['/c', 'npx', '--yes', '@vscode/vsce@3', 'ls'], {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 32 * 1024 * 1024,
      })
    : execFileSync('npx', ['--yes', '@vscode/vsce@3', 'ls'], {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 32 * 1024 * 1024,
      });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function main() {
  let files;
  try {
    files = readFileList();
  } catch (e) {
    console.error('❌ 拿不到打包文件清单（vsce ls 失败）：', e.message);
    process.exit(1);
  }

  const errors = [];

  for (const f of files) {
    for (const bad of FORBIDDEN) {
      if (f === bad.prefix || f.startsWith(bad.prefix)) {
        errors.push(`❌ "${f}" 不该进包 —— ${bad.why}`);
      }
    }
  }

  for (const need of REQUIRED) {
    const hit = files.find((f) => f === need.prefix || f.startsWith(need.prefix));
    if (!hit) {
      errors.push(`❌ 缺少 "${need.prefix}" —— ${need.why}。装完插件会直接不能用。`);
    }
  }

  const total = files.length;

  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' 打包守卫');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(` 清单文件数：${total}`);

  // ── 体积检查 ──────────────────────────────────────────────
  //
  // 清单看着对、体积却不对，是另一类事故：
  //   2026-10-26 实测 out/__tests__/ 漏排除，
  //   清单里文件数"正常"（254 个），但里面塞了 633KB 的编译后测试代码，
  //   而且那些文件里有故意伪造的假密钥，vsce 直接拒绝打包。
  //
  //   所以体积要【单独卡一道】，不能只看清单。
  const vsixFiles = fs
    .readdirSync(ROOT)
    .filter((f) => f.endsWith('.vsix'))
    .map((f) => path.join(ROOT, f));

  if (vsixFiles.length === 0) {
    console.log(' ℹ️ 仓库里没有 .vsix（还没打包），跳过体积检查');
  } else {
    for (const v of vsixFiles) {
      const bytes = fs.statSync(v).size;
      const mb = bytes / (1024 * 1024);
      if (bytes > MAX_VSIX_BYTES) {
        err(
          CHECK,
          `${path.basename(v)} 有 ${mb.toFixed(2)} MB，超过上限 ` +
            `${(MAX_VSIX_BYTES / 1024 / 1024).toFixed(1)} MB —— ` +
            `说明又漏了什么进包（大概率是 out/ 里的子目录）。`,
        );
      } else {
        console.log(
          ` ✅ ${path.basename(v)}：${(bytes / 1024).toFixed(0)} KB（${mb.toFixed(2)} MB）` +
            ` ≤ 上限 ${(MAX_VSIX_BYTES / 1024 / 1024).toFixed(1)} MB`,
        );
      }
    }
  }

  if (errors.length === 0) {
    console.log(' ✅ 没有泄漏，必需文件齐全');
    console.log('');
    process.exit(0);
  }

  for (const e of errors.slice(0, 40)) console.log(`  ${e}`);
  if (errors.length > 40) console.log(`  ... 还有 ${errors.length - 40} 条`);
  console.log('');
  console.log(`❌ ${errors.length} 项未通过`);
  console.log('   修法：改 .vscodeignore（注意 vsce 不读 .gitignore）');
  console.log('');
  process.exit(1);
}

main();
