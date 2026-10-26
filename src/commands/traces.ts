/**
 * /traces —— 查看本次会话的调用链
 *
 * ⭐ 这解决什么问题
 *
 *   agent 卡住了、token 涨得飞快、某个工具反复调 —— 
 *   这三个问题光看聊天记录是【看不出来】的：
 *   聊天记录只告诉你"说了什么"，不告诉你"干了什么、每步多贵"。
 *
 *   这个命令把 OpenTelemetry 风格的 span 记录渲染成一张【调用链树】：
 *
 *     gen_ai.chat  [820ms]  gen_ai.request.model=deepseek-chat  in=12345  out=678
 *       └ gen_ai.tool  [31ms]  gen_ai.tool.name=read_file
 *       └ gen_ai.tool  [152ms]  gen_ai.tool.name=grep
 *
 *   比喻：行车记录仪。不看录像你只知道"车开过"，看了才知道"在哪停过、停多久"。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 这里【不】记录 prompt 内容
 *
 *   跟 spans.ts 的设计一致：默认只记"调了什么、多快、多少 token"，
 *   不记"prompt 原文"。要记必须显式设环境变量 MINI_CODER_TRACE_CONTENT=1。
 *   理由见 spans.ts 的文件头。
 */

import * as vscode from 'vscode';
import { getSpanRecorder, TRACE_CONTENT_ENV } from '../observability/spans';
import { info } from '../logger';

/**
 * 渲染调用链报告（markdown）
 *
 * 抽成独立函数是为了让 slash command 和 VS Code 命令共用同一套渲染，
 * 不会出现"两个地方显示的不一样"。
 */
export function renderTracesReport(): string {
  const rec = getSpanRecorder();
  const all = rec.getAll();
  const st = rec.summary();

  if (all.length === 0) {
    return (
      '🔍 本次会话还没有追踪记录。\n\n' +
      '跑一轮 agent 任务之后再来看看 —— 每次 LLM 调用和每次工具调用都会留下一条记录。'
    );
  }

  const lines: string[] = [];
  lines.push('🔍 调用链');
  lines.push('');
  lines.push('```');
  lines.push(rec.renderTree());
  lines.push('```');
  lines.push('');

  // ── token 账单 ──
  //   把所有 chat span 的 usage 加起来 —— 这是"这次任务花了多少"的最直接答案。
  let inTok = 0;
  let outTok = 0;
  const models = new Set<string>();
  for (const s of all) {
    if (s.name !== 'gen_ai.chat') continue;
    inTok += Number(s.attributes['gen_ai.usage.input_tokens'] ?? 0);
    outTok += Number(s.attributes['gen_ai.usage.output_tokens'] ?? 0);
    const m = s.attributes['gen_ai.request.model'];
    if (m) models.add(String(m));
  }

  lines.push('**用量**');
  lines.push(`- LLM 调用：${all.filter((s) => s.name === 'gen_ai.chat').length} 次`);
  lines.push(`- 工具调用：${all.filter((s) => s.name === 'gen_ai.tool').length} 次`);
  if (inTok || outTok) {
    lines.push(`- token：输入 ${inTok.toLocaleString('zh-CN')} / 输出 ${outTok.toLocaleString('zh-CN')}`);
  }
  if (models.size > 0) {
    lines.push(`- 模型：${[...models].join('、')}`);
  }
  lines.push(`- 耗时合计：${st.totalDurationMs} ms`);
  if (st.errors > 0) {
    lines.push(`- ⚠ 错误：${st.errors} 个`);
  }

  // ── 慢工具榜 ──
  //   "为什么这么慢"这个问题，八成是某个工具拖的。
  const tools = all.filter((s) => s.name === 'gen_ai.tool');
  if (tools.length > 0) {
    const sorted = [...tools].sort(
      (a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0),
    );
    const top = sorted.slice(0, 3);
    lines.push('');
    lines.push('**最慢的 3 个工具**');
    for (const s of top) {
      const name = String(s.attributes['gen_ai.tool.name'] ?? '?');
      lines.push(`- ${name} —— ${s.durationMs ?? 0} ms`);
    }
  }

  lines.push('');
  lines.push(
    `> 💡 默认【不记录 prompt 内容】（避免把源码抄到磁盘上）。` +
      `需要记录请设环境变量 ${TRACE_CONTENT_ENV}=1。`,
  );
  lines.push('> 用 `/traces clear` 清空记录。');

  return lines.join('\n');
}

/**
 * 注册 `mini-coder.showTraces` 命令
 *
 * ⭐ 为什么要同时有 slash command 和 VS Code 命令
 *
 *   · slash command（/traces）：在聊天框里打，最顺手，适合"边聊边看"
 *   · VS Code 命令（命令面板）：面板没开的时候也能看，适合"出问题了才查"
 */
export function registerTracesCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.showTraces', async () => {
      const report = renderTracesReport();
      info(report);

      const rec = getSpanRecorder();
      const hasSpans = rec.getAll().length > 0;

      const action = await vscode.window.showInformationMessage(
        hasSpans
          ? `调用链已输出到「输出 → Mini-Coder」（${rec.getAll().length} 条记录）`
          : '本次会话还没有追踪记录',
        ...(hasSpans ? ['复制', '清空'] : []),
      );

      if (action === '复制') {
        await vscode.env.clipboard.writeText(report);
        vscode.window.showInformationMessage('✓ 调用链已复制到剪贴板');
      } else if (action === '清空') {
        rec.clear();
        vscode.window.showInformationMessage('✓ 追踪记录已清空');
      }
    }),
  );
}
