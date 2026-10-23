/**
 * 大输出外置（toolOutputStore）测试
 *
 * 为什么这组测试重要：
 *   外置是个"优化"，最容易出的 bug 是【静默降级】——
 *   落盘失败时悄悄返回原内容，功能看起来正常，但 token 一点没省，
 *   于是"优化好像没效果"却找不到原因。
 *   所以这里专门测降级路径：失败时是否还返回完整内容、是否抛异常。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  maybeExternalize,
  setToolOutputEnabled,
  clearStoredOutputs,
  listStoredOutputs,
  EXTERNALIZE_THRESHOLD,
  TOOL_OUTPUT_DIR,
} from '../../agent/toolOutputStore';
import { setWorkspaceRoot } from '../../agent/tools/paths';

let testRoot: string;

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolout-test-'));
  setWorkspaceRoot(testRoot);
  setToolOutputEnabled(true);
});

afterEach(() => {
  try {
    fs.rmSync(testRoot, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
  setWorkspaceRoot(os.tmpdir());
  setToolOutputEnabled(true);
});

/** 造一个超过阈值的大字符串 */
function bigText(): string {
  return 'A'.repeat(EXTERNALIZE_THRESHOLD + 5000);
}

describe('toolOutputStore', () => {
  // ────────────────────────────────────────────────────────────
  // 基本行为
  // ────────────────────────────────────────────────────────────
  describe('阈值判断', () => {
    it('小输出原样返回，不落盘', () => {
      const content = '很短的输出';
      const r = maybeExternalize('read_file', content);

      expect(r.stored).toBeNull();
      expect(r.content).toBe(content);
      expect(fs.existsSync(path.join(testRoot, TOOL_OUTPUT_DIR))).toBe(false);
    });

    it('刚好等于阈值不外置（边界：只有严格大于才外置）', () => {
      const content = 'A'.repeat(EXTERNALIZE_THRESHOLD);
      const r = maybeExternalize('read_file', content);

      expect(r.stored).toBeNull();
      expect(r.content).toBe(content);
    });

    it('刚超过阈值就外置', () => {
      const r = maybeExternalize('read_file', bigText());

      expect(r.stored).not.toBeNull();
      expect(r.stored!.originalChars).toBe(EXTERNALIZE_THRESHOLD + 5000);
    });

    it('外置后上下文占用大幅下降（这是这个模块存在的意义）', () => {
      const original = bigText();
      const r = maybeExternalize('read_file', original);

      expect(r.stored).not.toBeNull();
      // 回灌内容应该远小于原始内容
      expect(r.content.length).toBeLessThan(original.length / 5);
      // 但必须包含文件路径，否则 LLM 找不回去
      expect(r.content).toContain(r.stored!.relPath);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 占位符内容：这是模型唯一的指引，写不好等于功能没做
  // ────────────────────────────────────────────────────────────
  describe('占位符内容', () => {
    it('包含原字符数、行数、路径、预览、以及怎么取回内容', () => {
      const content = bigText();
      const r = maybeExternalize('read_file', content);

      expect(r.content).toContain('输出过大');
      expect(r.content).toContain(String(content.length)); // 字符数
      expect(r.content).toContain('read_file'); // 提示用 read_file 取回
      expect(r.content).toContain('offset'); // 教它别整个读回来
      expect(r.content).toContain(r.stored!.relPath);
    });

    it('保头保尾：开头和结尾都在预览里（报错信息通常在末尾）', () => {
      const content = '开头标记HEAD' + 'B'.repeat(20000) + '结尾标记TAIL';
      const r = maybeExternalize('run_shell', content);

      expect(r.stored).not.toBeNull();
      expect(r.content).toContain('开头标记HEAD');
      expect(r.content).toContain('结尾标记TAIL');
    });
  });

  // ────────────────────────────────────────────────────────────
  // 落盘
  // ────────────────────────────────────────────────────────────
  describe('落盘文件', () => {
    it('文件真的写到工作区里，内容与原始完全一致', () => {
      const content = bigText();
      const r = maybeExternalize('grep', content);

      const abs = path.join(testRoot, r.stored!.relPath);
      expect(fs.existsSync(abs)).toBe(true);
      expect(fs.readFileSync(abs, 'utf-8')).toBe(content);
    });

    it('相同内容不会重复存两份（内容哈希去重）', () => {
      const content = bigText();
      const a = maybeExternalize('read_file', content);
      const b = maybeExternalize('read_file', content);

      expect(a.stored!.id).toBe(b.stored!.id);
      expect(listStoredOutputs().length).toBe(1);
    });

    it('文件路径不含任何路径穿越风险字符', () => {
      const r = maybeExternalize('../../etc/passwd', bigText());
      expect(r.stored).not.toBeNull();
      expect(r.stored!.relPath).not.toContain('..');
      expect(r.stored!.relPath.startsWith(TOOL_OUTPUT_DIR)).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 开关：评测沙箱必须能关掉
  // ────────────────────────────────────────────────────────────
  describe('总开关', () => {
    it('关闭后原样返回，不落盘', () => {
      setToolOutputEnabled(false);
      const content = bigText();
      const r = maybeExternalize('read_file', content);

      expect(r.stored).toBeNull();
      expect(r.content).toBe(content);
      expect(fs.existsSync(path.join(testRoot, TOOL_OUTPUT_DIR))).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 短输出工具白名单
  // ────────────────────────────────────────────────────────────
  describe('短输出工具不外置', () => {
    it.each(['apply_patch', 'write_file', 'restore_file', 'record_note'])(
      '%s 的超大输出也不外置（输出本来就短，外置纯属浪费）',
      (tool) => {
        const r = maybeExternalize(tool, bigText());
        expect(r.stored).toBeNull();
        expect(r.content).toBe(bigText());
      },
    );
  });

  // ─────────────────────────────────────────────────────────────
  // 降级路径：这是最容易静默失效的地方
  // ─────────────────────────────────────────────────────────────
  describe('降级（绝不能因为优化失败而让主流程失败）', () => {
    it('工作区不可写时静默降级为原样返回，不抛异常', () => {
      // ⭐ 造一个真正会失败的工作区：
      //   用【一个普通文件】当作工作区根，这样 mkdir 会在它下面失败（ENOTDIR）。
      //
      //   注意不能用"不存在的目录"来测—— atomicWrite 里有 mkdirSync(recursive:true)，
      //   会把目录顺带建出来，那样反而写入成功，测不到降级路径。
      const notADir = path.join(os.tmpdir(), `file-not-dir-${Date.now()}.txt`);
      fs.writeFileSync(notADir, 'I am a file, not a directory');
      setWorkspaceRoot(notADir);

      let result: ReturnType<typeof maybeExternalize> | undefined;
      expect(() => {
        result = maybeExternalize('read_file', bigText());
      }).not.toThrow();

      // 关键：必须是完整原文，不能是空、不能是截断
      expect(result!.stored).toBeNull();
      expect(result!.content).toBe(bigText());

      fs.unlinkSync(notADir);
    });

    it('空内容不崩', () => {
      expect(() => maybeExternalize('read_file', '')).not.toThrow();
      expect(maybeExternalize('read_file', '').content).toBe('');
    });
  });

  // ────────────────────────────────────────────────────────────
  // 清理
  // ────────────────────────────────────────────────────────────
  describe('清理', () => {
    it('clearStoredOutputs 清掉全部已外置文件', () => {
      maybeExternalize('read_file', bigText());
      maybeExternalize('grep', 'B'.repeat(EXTERNALIZE_THRESHOLD + 100));
      expect(listStoredOutputs().length).toBe(2);

      const removed = clearStoredOutputs();
      expect(removed).toBe(2);
      expect(listStoredOutputs().length).toBe(0);
    });

    it('目录不存在时清理不抛异常', () => {
      expect(() => clearStoredOutputs()).not.toThrow();
      expect(clearStoredOutputs()).toBe(0);
    });
  });
});