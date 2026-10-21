/**
 * ContextBuilder：拼装 system prompt
 *
 * 为什么需要它：
 * - LLM 是无状态的，每次请求都要带完整对话
 * - system prompt 决定 agent 行为（写得对 = 行为正确 80%）
 * - system prompt 在每轮请求最前面，LLM 对开头指令更敏感
 *
 * 设计原则（按重要性排）：
 * 1. identity（身份）  2. workflow（工作流）  3. conventions（约定）
 * 4. project bootstrap（项目规则）  ← 新增，借鉴自 nanobot
 *
 * 借鉴来源：D:/AI agent/nanobot-main/nanobot/agent/context.py
 *   - BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "USER.md"]
 *   - _load_bootstrap_files() 自动加载项目级 .md 文件，拼进 system prompt
 *   - 用户在工作区放 AGENTS.md 写项目规则，agent 自动遵守
 *
 * 优势（vs Cursor / Cline）：
 * - 用户可以"教"agent 项目级约定（命名 / 格式 / 禁止事项）
 * - 这是差异化点，Cursor / Cline 都没做
 */

import * as fs from 'fs';
import * as path from 'path';

/** 项目级规则文件，agent 启动时自动加载 */
const BOOTSTRAP_FILES = ['AGENTS.md', 'SOUL.md', 'USER.md'];

/** 单文件最大字节数（防恶意大文件撑爆 prompt） */
const MAX_BOOTSTRAP_BYTES = 50_000;

export class ContextBuilder {
  /**
   * @param workspaceRoot 当前 VS Code 工作区根目录（用于找 AGENTS.md）
   *                     传 null 时跳过 bootstrap（用于测试 / 单文件模式）
   */
  constructor(private workspaceRoot: string | null = null) {}

  /**
   * 拼装完整 system prompt
   * 拼接顺序（重要性递减）：
   *   1. identity（身份 + 工作流 + 中文 commit + 错题本 + 工具限制）
   *   2. bootstrap files（用户写的项目规则）
   *   3. project info（当前工作区路径）
   */
  buildSystemPrompt(): string {
    const identity = this._getIdentity();
    const bootstrap = this._loadBootstrapFiles();
    const projectInfo = this._getProjectInfo();

    return [identity, bootstrap, projectInfo].filter(Boolean).join('\n\n---\n\n');
  }

  /** 核心身份与工作流约定 */
  private _getIdentity(): string {
    return `# Mini-Coder 身份

你是 VS Code AI 编程助手，运行在用户本地工作目录。
目标：帮用户完成真实编码任务——读文件、改文件、跑命令、跑测试。

# 核心约定

1. 先了解再动手：动手前先 ls / read / grep，不要盲目改
2. 优先用 apply_patch，不用 write_file 整文件覆盖
3. 修改后必须验证：改完跑测试，确认没破坏其他功能
4. 不要生造内容：read 不到就说不存在，不要瞎编
5. 承认错误：发现改错立刻 rollback

# 中文 commit 规范

生成 commit message 用中文，按以下规范：
- 功能: 新功能
- 修复: bug 修复
- 文档: 文档更新
- 重构: 代码重构
- 测试: 测试相关
- 样式: 格式化
- 杂项: 其他

格式：\`类型: 简短描述（不超过 50 字）\`
示例：\`功能: 加登录页支持 OAuth 登录\`

# 错题本归档（record_note）

任务结束前，如果你【学到了东西】，调用 record_note 记一条。什么算学到：
- 改了不 obvious 的东西 —— 说清为什么这么选、放弃了哪些方案
- 踩了坑 —— 某个命令/工具/库在当前环境不工作（比如"head 在 Windows 下不存在"）
- 发现反直觉的事实

**不要记**：纯机械改动（改常量、加日志、改注释）、没学到新东西时。
错题本被垃圾淹没就失去意义了。

pitfalls 那一栏最重要 —— 它是"错题本"区别于"文件修改日志"的关键。

# 工作流（典型顺序）

1. 用户问任务 → list_dir 了解结构
2. grep / read_file 定位相关代码
3. apply_patch 改代码
4. run_shell 跑测试
5. 有收获就 record_note 记一条
6. 报告结果

# 工具限制

- max_iterations=30（防死循环）
- 单次工具输出 > 30000 字符会被截断（保留头尾，报错在尾部）
- shell 命令默认超时 30 秒
- 改错了可以用 restore_file 或让用户执行 /undo 退回
- 写文件前会自动存 checkpoint，可随时还原`;
  }

  /**
   * 自动加载项目级 .md 规则文件
   *
   * 借鉴自 nanobot/context.py 的 _load_bootstrap_files
   * 顺序：AGENTS.md（项目规则）→ SOUL.md（agent 人格）→ USER.md（用户偏好）
   * 每个文件独立一段，方便 LLM 区分
   *
   * 安全措施：
   * - 只读 <workspaceRoot>/<filename>，不递归（避免读无关目录）
   * - 单文件最大 50KB（防恶意撑爆 prompt）
   * - 空文件 / 不存在的文件静默跳过
   */
  private _loadBootstrapFiles(): string {
    if (!this.workspaceRoot) return '';

    const parts: string[] = [];

    for (const filename of BOOTSTRAP_FILES) {
      const filePath = path.join(this.workspaceRoot, filename);

      if (!fs.existsSync(filePath)) continue;

      try {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_BOOTSTRAP_BYTES) {
          console.warn(
            `[Mini-Coder] ${filename} 超过 ${MAX_BOOTSTRAP_BYTES} 字节，跳过（防止撑爆 prompt）`,
          );
          continue;
        }

        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (!content) continue;

        parts.push(`## ${filename}\n\n${content}`);
      } catch (e) {
        // 读取失败（如权限问题）静默跳过，不阻塞 agent
        console.warn(`[Mini-Coder] 读取 ${filename} 失败: ${e}`);
      }
    }

    if (parts.length === 0) return '';

    return `# 项目规则（自动加载自 AGENTS.md / SOUL.md / USER.md）

> 用户可以在工作区根目录放这些 .md 文件，告诉 agent 项目约定。
> Cursor / Cline 都没这个功能——这是 Mini-Coder 的差异化能力。

${parts.join('\n\n')}`;
  }

  /** 当前工作区信息（让 agent 知道自己在哪个项目里） */
  private _getProjectInfo(): string {
    if (!this.workspaceRoot) return '';

    return `# 当前项目

工作目录：\`${this.workspaceRoot}\`

相对路径以此为根。修改文件用相对路径或绝对路径均可。`;
  }
}
