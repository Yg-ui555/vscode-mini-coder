/**
 * UserPromptSubmit Hook —— 用户刚发了一条消息
 *
 * hook 的 stdout 会被【注入到上下文】里。
 * 典型用途：注入当前 git 分支、注入待办清单、注入时间。
 *
 * ⭐ 只在【第一轮】跑
 *
 *   语义是"用户刚提交了一条 prompt"，不是"每轮都跑一次"。
 *   如果每轮都跑，hook 注入的内容会在上下文里堆 N 份，
 *   既浪费 token 又让模型看到互相重复的上下文。
 */

import { getHookManager } from '../hooks/manager';
import { getDefaultCwd } from '../tools/paths';
import { info } from '../../logger';
import { Operation, OperationResult, notApplicable, applied } from './types';

export const userPromptSubmitOperation: Operation = {
  name: 'user_prompt_submit',

  async run(ctx): Promise<OperationResult> {
    // 只在第一轮跑（后面几轮是 agent 自己在推进，不是用户又说话了）
    if (ctx.iteration > 0) return notApplicable();

    const hooks = getHookManager();
    if (!hooks.hasHooks) return notApplicable();

    // 找用户最后一条消息
    let prompt = '';
    for (let i = ctx.messages.length - 1; i >= 0; i--) {
      if (ctx.messages[i]?.role === 'user') {
        prompt = String(ctx.messages[i].content ?? '');
        break;
      }
    }

    const outcome = await hooks.runUserPromptSubmit(prompt, getDefaultCwd());
    if (outcome.problem) info(`[hook] UserPromptSubmit: ${outcome.problem}`);
    if (!outcome.output) return notApplicable();

    ctx.messages.push({
      role: 'user',
      content: `[hook 注入的上下文]\n${outcome.output}`,
    });
    info(`[hook] UserPromptSubmit 注入 ${outcome.output.length} 字符上下文`);
    return applied();
  },
};
