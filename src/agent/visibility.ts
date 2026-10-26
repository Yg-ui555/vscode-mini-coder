/**
 * 双可见性 —— 「用户看到的」与「模型看到的」解耦
 *
 * ─────────────────────────────────────────────────────────────
 * 这个文件为什么从 loop.ts 里独立出来
 *
 *   因为它被【三处】需要：
 *     · 上下文压缩（算 token 时要按模型可见的那份算）
 *     · 重复调用检测的第四重校验（"原结果还在不在模型上下文里"）
 *     · 推理前过滤（真正发给 provider 的那份）
 *
 *   放在 loop.ts 里的话，operations/ 下的压缩/推理两个 Operation
 *   都得 import loop.ts → 循环依赖（loop.ts 也要 import operations/）。
 *   独立成文件，依赖方向就是单向的：loop → operations → visibility。
 *
 * ─────────────────────────────────────────────────────────────
 * 机制本身
 *
 *   借鉴 goose 的两个投影函数：
 *     · agent_visible_content() —— 喂给模型的（goose message.rs:985）
 *     · user_visible_content()  —— 喂给 UI 的（goose message.rs:998）
 *
 *   ⚠️⚠️ 最关键的一行是 filterForModel 里的过滤：
 *     如果只是给消息打 agentVisible=false 标记、但请求时照样全量发送，
 *     那 token 一分钱都没省，而且模型会看到一堆互相矛盾的历史
 *     （摘要说"我们改完了"，但下面还挂着没被压掉的原始对话）。
 *
 *   所以：每次请求前必须过滤。
 */

import { setVisibleCallIds } from './tools/repeatGuard';

/**
 * 过滤出「模型可见」的消息
 *
 * agentVisible === false 的消息对模型隐藏，但仍然留在 messages 里，
 * 用户在 Webview 里仍能滚动查看（灰显 + "已压缩"角标）。
 */
export function filterForModel(messages: any[]): any[] {
  return messages.filter((m) => m?.agentVisible !== false);
}

/**
 * 重算「当前上下文里模型还看得见的 tool_call_id 集合」
 *
 * 重复检测的第四重校验依赖它：
 *   只有当上次的工具结果【还在模型上下文里】时，
 *   才敢返回「文件没变」的提示；否则必须老老实实重读。
 *
 * 注意：这里扫的是【过滤后】的 messages ——
 * 被隐藏的消息模型看不见，所以它们的结果也不算「可见」。
 */
export function refreshVisibleCallIds(messages: any[]): void {
  const ids = new Set<string>();
  for (const m of filterForModel(messages)) {
    if (m?.role === 'tool' && typeof m.tool_call_id === 'string') {
      ids.add(m.tool_call_id);
    }
  }
  setVisibleCallIds(ids);
}
