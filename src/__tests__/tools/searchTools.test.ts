/**
 * 搜索工具测试：grep / glob / list_dir
 *
 * 为什么这三个工具必须有测试：
 *   它们是 agent 做跨文件任务的唯一手段，出错时症状很隐蔽 ——
 *   比如 grep 静默返回空结果，LLM 会以为"代码里没有这个函数"，
 *   然后就顺着错误的假设一路改下去。这类 bug 单靠肉眼 review 抓不到。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { GrepTool } from '../../agent/tools/grep';
import { GlobTool } from '../../agent/tools/glob';
import { ListDirTool } from '../../agent/tools/listDir';
import { globToRegExp, walkFiles, isBinaryPath } from '../../agent/tools/fileScan';
import { setWorkspaceRoot } from '../../agent/tools/paths';

describe('搜索工具', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-coder-scan-'));
    setWorkspaceRoot(tmpDir);

    // 造一个典型的小项目结构
    await fs.mkdir(path.join(tmpDir, 'src', 'utils'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'node_modules', 'junk'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, '.git'), { recursive: true });

    await fs.writeFile(
      path.join(tmpDir, 'src', 'index.ts'),
      "import { helper } from './utils/helper';\nexport function main() { return helper(); }\n",
      'utf-8',
    );
    await fs.writeFile(
      path.join(tmpDir, 'src', 'utils', 'helper.ts'),
      'export function helper() {\n  // TODO: 优化这里\n  return 42;\n}\n',
      'utf-8',
    );
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# 项目\n\nTODO: 写文档\n', 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'node_modules', 'junk', 'bad.ts'), 'helper TODO', 'utf-8');
    await fs.writeFile(path.join(tmpDir, '.git', 'config'), 'TODO', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ────────────────────────── grep ──────────────────────────

  describe('GrepTool', () => {
    it('按内容搜到匹配，返回 文件:行号:内容', async () => {
      const tool = new GrepTool();
      const result = await tool.execute({ pattern: 'TODO' });

      expect(result.isError).toBeFalsy();
      // helper.ts 里 TODO 在第 2 行（内容是 export...{ / // TODO / return / }）
      expect(result.content).toMatch(/src\/utils\/helper\.ts:2:/);
      // README.md 里 TODO 在第 3 行（# 项目 / 空行 / TODO）
      expect(result.content).toMatch(/README\.md:3:/);
    });

    it('⭐ 自动跳过 node_modules 和 .git（否则一次 grep 扫几万文件）', async () => {
      const tool = new GrepTool();
      const result = await tool.execute({ pattern: 'TODO' });

      // node_modules/junk/bad.ts 和 .git/config 里有 TODO，但不该出现在结果里
      expect(result.content).not.toMatch(/node_modules/);
      expect(result.content).not.toMatch(/\.git/);
    });

    it('glob 参数能限定文件范围', async () => {
      const tool = new GrepTool();
      const result = await tool.execute({ pattern: 'TODO', glob: '**/*.md' });

      expect(result.content).toMatch(/README\.md/);
      expect(result.content).not.toMatch(/helper\.ts/);
    });

    it('非法正则 → 返回可操作的错误提示，不是崩溃', async () => {
      const tool = new GrepTool();
      const result = await tool.execute({ pattern: '([unclosed' });

      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/正则表达式无效/);
      // 提示必须告诉 LLM 怎么改，而不是干巴巴一句"报错"
      expect(result.content).toMatch(/转义/);
    });

    it('搜不到时明确说明"已扫描 N 个文件"（区分"没搜到"和"没搜"）', async () => {
      const tool = new GrepTool();
      const result = await tool.execute({ pattern: 'zzz绝对不存在的字符串zzz' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toMatch(/没有找到匹配/);
      // ⭐ 关键：必须告诉它搜过了、扫了几个文件，
      //    否则 LLM 会以为工具没执行，转头去用 run_shell
      expect(result.content).toMatch(/已扫描 \d+ 个文件/);
    });

    it('路径越界被拦截', async () => {
      const tool = new GrepTool();
      const result = await tool.execute({ pattern: 'x', path: '../../../etc' });

      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/超出工作区范围|路径/);
    });

    it('区分大小写可配置', async () => {
      const tool = new GrepTool();

      const insensitive = await tool.execute({ pattern: 'todo' });
      expect(insensitive.content).toMatch(/TODO/);

      const sensitive = await tool.execute({ pattern: 'todo', caseSensitive: true });
      expect(sensitive.content).toMatch(/没有找到匹配/);
    });
  });

  // ────────────────────────── glob ──────────────────────────

  describe('GlobTool', () => {
    it('双星号能跨层匹配', async () => {
      const tool = new GlobTool();
      const result = await tool.execute({ pattern: '**/*.ts' });

      expect(result.content).toMatch(/src\/index\.ts/);
      expect(result.content).toMatch(/src\/utils\/helper\.ts/);
      expect(result.content).not.toMatch(/node_modules/);
    });

    it('单星号不跨层', async () => {
      const tool = new GlobTool();
      const result = await tool.execute({ pattern: 'src/*.ts' });

      expect(result.content).toMatch(/src\/index\.ts/);
      expect(result.content).not.toMatch(/helper\.ts/); // 在 utils/ 子目录，不该匹配
    });

    it('大括号或或', async () => {
      const tool = new GlobTool();
      const result = await tool.execute({ pattern: '**/*.{ts,md}' });

      expect(result.content).toMatch(/index\.ts/);
      expect(result.content).toMatch(/README\.md/);
    });

    it('没匹配到时给出排查建议', async () => {
      const tool = new GlobTool();
      const result = await tool.execute({ pattern: '**/*.rs' });

      expect(result.content).toMatch(/没有文件匹配/);
      expect(result.content).toMatch(/list_dir/);
    });
  });

  // ────────────────────────── list_dir ──────────────────────────

  describe('ListDirTool', () => {
    it('列出目录和文件，目录以 / 结尾', async () => {
      const tool = new ListDirTool();
      const result = await tool.execute({});

      expect(result.isError).toBeFalsy();
      expect(result.content).toMatch(/src\//);
      expect(result.content).toMatch(/README\.md/);
    });

    it('隐藏常见目录但告知隐藏了几个', async () => {
      const tool = new ListDirTool();
      const result = await tool.execute({});

      // 只检查"目录:"和"文件:"两段里没出现 node_modules / .git
      // （页脚的提示文字里会举这两个名字做例子，那是故意的）
      const listing = result.content.split('共 ')[0];
      expect(listing).not.toMatch(/node_modules/);
      expect(listing).not.toMatch(/\.git/);
      expect(result.content).toMatch(/已自动隐藏 \d+ 个常见目录/);
    });

    it('路径不是目录 → 给出正确引导', async () => {
      const tool = new ListDirTool();
      const result = await tool.execute({ path: path.join(tmpDir, 'README.md') });

      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/不是目录/);
    });

    it('目录不存在 → 明确报错', async () => {
      const tool = new ListDirTool();
      const result = await tool.execute({ path: path.join(tmpDir, 'no-such-dir') });

      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/目录不存在/);
    });
  });

  // ────────────────────────── 底层工具函数 ──────────────────────────

  describe('fileScan 底层函数', () => {
    it('globToRegExp 转换正确', () => {
      expect(globToRegExp('**/*.ts').test('src/a.ts')).toBe(true);
      expect(globToRegExp('**/*.ts').test('src/a.js')).toBe(false);
      expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
      expect(globToRegExp('src/*.ts').test('src/deep/a.ts')).toBe(false);
      expect(globToRegExp('*.md').test('a.md')).toBe(true);
      expect(globToRegExp('*.md').test('dir/a.md')).toBe(false);
    });

    it('walkFiles 会跳过忽略目录', async () => {
      const { files } = walkFiles({ root: tmpDir });
      const rels = files.map((f) => f.rel);

      expect(rels.some((r) => r.includes('node_modules'))).toBe(false);
      expect(rels.some((r) => r.includes('.git'))).toBe(false);
      expect(rels).toContain('src/index.ts');
    });

    it('二进制文件识别', () => {
      expect(isBinaryPath('a.png')).toBe(true);
      expect(isBinaryPath('a.exe')).toBe(true);
      expect(isBinaryPath('a.ts')).toBe(false);
      expect(isBinaryPath('a.md')).toBe(false);
    });
  });

  // ────────────────────────── 工具元数据 ──────────────────────────

  describe('工具元数据', () => {
    it('搜索类工具都是只读（权限分级里自动放行）', () => {
      expect(new GrepTool().meta?.readOnly).toBe(true);
      expect(new GlobTool().meta?.readOnly).toBe(true);
      expect(new ListDirTool().meta?.readOnly).toBe(true);
    });
  });
});
